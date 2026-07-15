import fs from "node:fs";
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "baileys";
import pino from "pino";

function statusCode(lastDisconnect) {
  return lastDisconnect?.error?.output?.statusCode
    ?? lastDisconnect?.error?.data?.statusCode
    ?? lastDisconnect?.error?.statusCode
    ?? null;
}

function fatalStatus(status) {
  return [
    DisconnectReason.loggedOut,
    DisconnectReason.badSession,
    DisconnectReason.forbidden,
    DisconnectReason.multideviceMismatch,
    DisconnectReason.connectionReplaced,
  ].includes(status);
}

function unwrapMessage(message = {}) {
  let current = message;
  while (current) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }
    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }
    break;
  }
  return current || {};
}

function extractText(message = {}) {
  const content = unwrapMessage(message);
  return content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || "";
}

export function sanitizeLogValue(value) {
  if (value == null || ["string", "number", "boolean"].includes(typeof value)) return value;
  const status = value?.output?.statusCode ?? value?.statusCode ?? value?.status ?? value?.code ?? null;
  const message = typeof value?.message === "string" ? value.message : value instanceof Error ? value.name : null;
  if (message && status != null) return `${message} (status ${status})`;
  if (message) return message;
  if (status != null) return `Status ${status}`;
  return "[redacted object]";
}

function operationalLogger(logger) {
  const call = (method, values) => {
    const target = typeof logger?.[method] === "function" ? logger[method].bind(logger) : logger?.log?.bind(logger);
    target?.(...values.map(sanitizeLogValue));
  };
  return {
    log: (...values) => call("log", values),
    warn: (...values) => call("warn", values),
    error: (...values) => call("error", values),
  };
}

export function createBaileysTransport({
  authDirectory,
  operationsGroupId,
  onInboundMessage = async () => {},
  logger = console,
}) {
  const baileysLogger = pino({ level: "silent" });
  const log = operationalLogger(logger);
  let socket = null;
  let connected = false;
  let stopped = false;
  let generation = 0;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  const waiters = new Set();

  function resolveWaiters(error = null) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      error ? waiter.reject(error) : waiter.resolve();
    }
    waiters.clear();
  }

  function scheduleReconnect(status) {
    if (stopped || reconnectTimer) return;
    reconnectAttempt += 1;
    const delay = status === DisconnectReason.restartRequired
      ? 500
      : Math.min(60000, 2000 * 2 ** Math.max(0, reconnectAttempt - 1));
    log.log(`WhatsApp reconnect ${reconnectAttempt} in ${Math.round(delay / 1000)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch((error) => {
        log.error("WhatsApp reconnect failed:", error);
        scheduleReconnect(null);
      });
    }, delay);
  }

  async function connect() {
    if (stopped) return;
    generation += 1;
    const currentGeneration = generation;
    const { state, saveCreds } = await useMultiFileAuthState(authDirectory);
    const current = makeWASocket({
      auth: state,
      logger: baileysLogger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });
    socket = current;
    current.ev.on("creds.update", saveCreds);
    current.ev.on("messages.upsert", async ({ messages, type }) => {
      if (currentGeneration !== generation || type !== "notify") return;
      for (const raw of messages) {
        const groupId = raw.key?.remoteJid || "";
        if (groupId !== operationsGroupId) continue;
        try {
          await onInboundMessage({
            groupId,
            messageId: raw.key?.id || "",
            senderId: raw.key?.participant || raw.key?.participantAlt || raw.participant || (raw.key?.fromMe ? current.user?.lid || current.user?.id : null) || groupId,
            fromMe: Boolean(raw.key?.fromMe),
            pushName: raw.pushName || "",
            text: extractText(raw.message),
            raw,
          });
        } catch (error) {
          log.error("Inbound message failed:", error);
        }
      }
    });
    current.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (currentGeneration !== generation) return;
      if (qr) log.error("WhatsApp authentication is missing. Run npm run setup:whatsapp.");
      if (connection === "open") {
        connected = true;
        reconnectAttempt = 0;
        log.log("WhatsApp connected.");
        resolveWaiters();
      }
      if (connection === "close") {
        connected = false;
        const status = statusCode(lastDisconnect);
        if (fatalStatus(status)) {
          const error = new Error("WhatsApp session requires pairing again");
          log.error(error);
          resolveWaiters(error);
        } else {
          scheduleReconnect(status);
        }
      }
    });
  }

  function assertConnected() {
    if (!connected || !socket) throw new Error("WhatsApp transport is not connected");
  }

  return {
    async start() {
      stopped = false;
      await connect();
    },
    waitUntilConnected(timeoutMs = 60000) {
      if (connected) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error("Timed out waiting for WhatsApp connection"));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
    isConnected: () => connected,
    async sendText({ groupId, text, purpose = "text" }) {
      assertConnected();
      if (!groupId?.endsWith("@g.us")) throw new Error("A valid WhatsApp group ID is required");
      if (!text?.trim()) throw new Error("Text cannot be empty");
      const response = await socket.sendMessage(groupId, { text });
      return { messageId: response?.key?.id || "", purpose };
    },
    async sendVoice({ groupId, filePath, purpose = "voice" }) {
      assertConnected();
      if (!groupId?.endsWith("@g.us")) throw new Error("A valid WhatsApp group ID is required");
      if (!fs.existsSync(filePath)) throw new Error(`Voice file not found: ${filePath}`);
      const response = await socket.sendMessage(groupId, {
        audio: fs.readFileSync(filePath),
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      });
      return { messageId: response?.key?.id || "", purpose };
    },
    async deleteMessage({ groupId, messageId, purpose = "delete" }) {
      assertConnected();
      if (!messageId) throw new Error("messageId is required");
      await socket.sendMessage(groupId, {
        delete: { remoteJid: groupId, fromMe: true, id: messageId },
      });
      return { messageId, purpose };
    },
    stop() {
      stopped = true;
      connected = false;
      generation += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      try { socket?.ws?.close(); } catch {}
      socket = null;
      resolveWaiters(new Error("WhatsApp transport stopped"));
    },
  };
}
