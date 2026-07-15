import fs from "node:fs";
import path from "node:path";
import {
  createInterface,
} from "node:readline/promises";
import {
  stdin,
  stdout,
} from "node:process";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "baileys";

import pino from "pino";
import QRCode from "qrcode";

import {
  fetchGroupsWithRetry,
  groupDisplayLabel,
  parseGroupSelection,
  saveConfigGroups,
} from "../src/setup/whatsappSetup.js";

import {
  validateHouseholdConfig,
} from "../src/config.js";

const CONFIG_PATH =
  path.resolve(
    process.env.CONFIG_PATH ||
    "config/household.json"
  );

const AUTH_DIRECTORY =
  path.resolve(
    process.env.AUTH_DIR ||
    "auth"
  );

const logger =
  pino({
    level: "silent",
  });

const rl =
  createInterface({
    input: stdin,
    output: stdout,
  });

let activeSocket = null;
let finished = false;
let connecting = false;

function statusCode(
  lastDisconnect
) {
  return (
    lastDisconnect
      ?.error
      ?.output
      ?.statusCode ||
    lastDisconnect
      ?.error
      ?.statusCode ||
    null
  );
}

function shouldReconnect(
  code
) {
  return (
    code !==
      DisconnectReason
        .loggedOut &&
    code !==
      DisconnectReason
        .badSession &&
    code !==
      DisconnectReason
        .forbidden &&
    code !==
      DisconnectReason
        .multideviceMismatch
  );
}

async function ask(
  prompt
) {
  return (
    await rl.question(
      prompt
    )
  ).trim();
}

async function chooseGroup(
  groups,
  label,
  defaultNumber = 1
) {
  while (true) {
    const answer =
      await ask(
        `${label} [${defaultNumber}]: `
      );

    try {
      return parseGroupSelection(
        answer ||
          String(
            defaultNumber
          ),
        groups,
        label
      );
    } catch (error) {
      console.log(
        error.message
      );
    }
  }
}

async function chooseYesNo(
  prompt,
  defaultValue = false
) {
  while (true) {
    const answer =
      (
        await ask(
          `${prompt} (${
            defaultValue
              ? "Y/n"
              : "y/N"
          }): `
        )
      ).toLowerCase();

    if (!answer) {
      return defaultValue;
    }

    if (
      ["y", "yes"].includes(
        answer
      )
    ) {
      return true;
    }

    if (
      ["n", "no"].includes(
        answer
      )
    ) {
      return false;
    }

    console.log(
      "Please answer yes or no."
    );
  }
}

async function selectAndSave(
  socket,
  config
) {
  console.log(
    "\nLoading WhatsApp groups..."
  );

  const groups =
    await fetchGroupsWithRetry(
      socket
    );

  console.log(
    `\nFound ${groups.length} groups:`
  );

  groups.forEach(
    (group, index) => {
      console.log(
        `${index + 1}. ${groupDisplayLabel(
          group
        )}`
      );
    }
  );

  console.log(
    "\nChoose by number."
  );

  console.log(
    "A group ID ending in @g.us may also be entered manually."
  );

  const operations =
    await chooseGroup(
      groups,
      "Operations group",
      1
    );

  const sameGroup =
    await chooseYesNo(
      "Use the same group for cook instructions?",
      false
    );

  const cook =
    sameGroup
      ? operations
      : await chooseGroup(
          groups,
          "Cook group",
          Math.min(
            2,
            groups.length
          )
        );

  const updated =
    saveConfigGroups(
      CONFIG_PATH,
      config,
      {
        operationsGroupId:
          operations.id,
        cookGroupId:
          cook.id,
      }
    );

  validateHouseholdConfig(
    updated
  );

  console.log(
    "\n✅ WHATSAPP SETUP COMPLETE"
  );

  console.log(
    `Operations: ${operations.subject}`
  );

  console.log(
    `Cook instructions: ${cook.subject}`
  );

  console.log(
    `Authentication saved locally in: ${AUTH_DIRECTORY}`
  );

  console.log(
    `Configuration updated locally: ${CONFIG_PATH}`
  );

  console.log(
    "\nNo message was sent to either group."
  );
}

function closeSocket() {
  try {
    activeSocket
      ?.ws
      ?.close();
  } catch {
    // Best-effort setup cleanup.
  }

  activeSocket = null;
}

async function connect(
  config
) {
  if (
    finished ||
    connecting
  ) {
    return;
  }

  connecting = true;

  const {
    state,
    saveCreds,
  } =
    await useMultiFileAuthState(
      AUTH_DIRECTORY
    );

  const socket =
    makeWASocket({
      auth: state,
      logger,
      syncFullHistory:
        false,
      markOnlineOnConnect:
        false,
      generateHighQualityLinkPreview:
        false,
    });

  activeSocket = socket;
  connecting = false;

  socket.ev.on(
    "creds.update",
    saveCreds
  );

  socket.ev.on(
    "connection.update",
    async (update) => {
      const {
        connection,
        lastDisconnect,
        qr,
      } = update;

      if (qr) {
        console.log(
          "\nScan this QR code:"
        );

        console.log(
          "WhatsApp → Settings → Linked Devices → Link a Device\n"
        );

        console.log(
          await QRCode.toString(
            qr,
            {
              type:
                "terminal",
              small:
                true,
            }
          )
        );
      }

      if (
        connection ===
        "open"
      ) {
        try {
          await selectAndSave(
            socket,
            config
          );

          finished = true;
          closeSocket();
          rl.close();
        } catch (error) {
          console.error(
            `\nSetup failed: ${error.message}`
          );

          finished = true;
          closeSocket();
          rl.close();
          process.exitCode = 1;
        }
      }

      if (
        connection ===
          "close" &&
        !finished
      ) {
        const code =
          statusCode(
            lastDisconnect
          );

        closeSocket();

        if (
          shouldReconnect(code)
        ) {
          console.log(
            "\nWhatsApp requested a reconnect. Continuing setup..."
          );

          setTimeout(
            () => {
              connect(
                config
              ).catch(
                (error) => {
                  console.error(
                    `Reconnect failed: ${error.message}`
                  );

                  process.exitCode =
                    1;
                  rl.close();
                }
              );
            },
            code ===
              DisconnectReason
                .restartRequired
              ? 500
              : 2000
          );
        } else {
          finished = true;

          console.error(
            "\nWhatsApp session cannot be reused. Remove the local auth folder and pair again."
          );

          process.exitCode =
            1;
          rl.close();
        }
      }
    }
  );
}

async function main() {
  if (
    !fs.existsSync(
      CONFIG_PATH
    )
  ) {
    throw new Error(
      "Local household configuration is missing. Run npm run setup first."
    );
  }

  const config =
    JSON.parse(
      fs.readFileSync(
        CONFIG_PATH,
        "utf8"
      )
    );

  validateHouseholdConfig(
    config,
    {
      allowIncompleteGroups:
        true,
    }
  );

  fs.mkdirSync(
    AUTH_DIRECTORY,
    {
      recursive: true,
    }
  );

  console.log(
    "\nFlat Meal Bot WhatsApp setup"
  );

  console.log(
    "This pairs a linked device, lists groups, and saves only local IDs."
  );

  console.log(
    "It does not send any WhatsApp messages."
  );

  await connect(config);
}

try {
  await main();
} catch (error) {
  console.error(
    error.message
  );

  process.exitCode = 1;
  rl.close();
}

process.on(
  "SIGINT",
  () => {
    finished = true;
    closeSocket();
    rl.close();
    process.exit(130);
  }
);
