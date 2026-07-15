import { cancelChange, confirmChange, createChange, undoChange } from "../domain/changes.js";
import { renderHelp, renderIdentityPrompt } from "../domain/renderer.js";
import { updateMemberDefault, updateWeeklyMenu } from "./configuration.js";
import { handleGuidedMessage } from "./guided.js";
import { findMemberBySender, linkSenderToMember, listMembers } from "./identity.js";
import { parseCommand } from "./parser.js";
import { tomorrowDate } from "./dates.js";

function recordInbound(database, envelope) {
  return database.prepare(`
    INSERT OR IGNORE INTO inbound_messages
      (group_id, message_id, sender_id, push_name, from_me, text)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    envelope.groupId,
    envelope.messageId,
    envelope.senderId,
    envelope.pushName || "",
    envelope.fromMe ? 1 : 0,
    envelope.text || ""
  ).changes === 1;
}

function mark(database, envelope, status, reason = null) {
  database.prepare(`
    UPDATE inbound_messages SET status = ?, failure_reason = ?, processed_at = CURRENT_TIMESTAMP
    WHERE group_id = ? AND message_id = ?
  `).run(status, reason, envelope.groupId, envelope.messageId);
}

function referenceMessage(prefix, changes, pending) {
  const lines = [prefix, ""];
  if (pending) {
    lines.push("Please confirm:", "", ...changes.map((change) => `• ${change.summary}`), "");
    lines.push(`Reply: confirm ${changes[0].stored.reference}`);
    lines.push(`Cancel: cancel ${changes[0].stored.reference}`);
  } else {
    lines.push("Saved:", "", ...changes.map((change) => `• ${change.summary}`), "");
    lines.push(`Undo: undo ${changes[changes.length - 1].stored.reference}`);
  }
  return lines.join("\n");
}

export function createInboundService({
  database,
  transport,
  config,
  onPlanChanged = async () => {},
  now = () => new Date(),
}) {
  const prefix = config.household.botPrefix;

  async function reply(groupId, text) {
    return transport.sendText({ groupId, text, purpose: "bot_reply" });
  }

  async function applyParsed(parsed, member, envelope, targetDate) {
    if (parsed.type === "help") {
      await reply(envelope.groupId, renderHelp(prefix));
      return;
    }

    if (parsed.type === "control") {
      if (parsed.control === "confirm") {
        const change = confirmChange(database, parsed.reference, member.id);
        await reply(envelope.groupId, `${prefix}\n\nConfirmed ${change.reference}.`);
        if (change.scopeStartDate <= targetDate && change.scopeEndDate >= targetDate) {
          await onPlanChanged(targetDate);
        }
        return;
      }
      if (parsed.control === "cancel") {
        const change = cancelChange(database, parsed.reference);
        await reply(envelope.groupId, `${prefix}\n\nCancelled ${change.reference}.`);
        return;
      }
      const result = undoChange(database, parsed.reference);
      await reply(envelope.groupId, `${prefix}\n\nUndone ${result.undone.reference}.`);
      if (result.undone.scopeStartDate <= targetDate && result.undone.scopeEndDate >= targetDate) {
        await onPlanChanged(targetDate);
      }
      return;
    }

    if (parsed.type === "default") {
      updateMemberDefault(database, {
        actorMemberId: member.id,
        memberId: member.id,
        mealType: parsed.mealType,
        quantityType: parsed.quantityType,
        itemKey: parsed.itemKey,
        value: parsed.value,
      });
      await reply(envelope.groupId, `${prefix}\n\nYour usual ${parsed.mealType} ${parsed.quantityType} default is now ${parsed.value}.`);
      await onPlanChanged(targetDate);
      return;
    }

    if (parsed.type !== "action") {
      await reply(envelope.groupId, renderHelp(prefix));
      return;
    }

    if (parsed.actions.length > 1 && parsed.actions.some((item) => item.requiresConfirmation)) {
      throw new Error("Send household-impacting changes one at a time so confirmation stays unambiguous");
    }

    const batchNeedsConfirmation = parsed.actions.some((item) => item.requiresConfirmation);
    const saved = [];
    const savepoint = `inbound_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    database.exec(`SAVEPOINT ${savepoint}`);
    try {
      for (const item of parsed.actions) {
        const input = batchNeedsConfirmation
          ? { ...item, requiresConfirmation: true }
          : item;
        saved.push({ ...item, stored: createChange(database, input) });
      }
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
      throw error;
    }

    await reply(envelope.groupId, referenceMessage(prefix, saved, batchNeedsConfirmation));
    if (!batchNeedsConfirmation && saved.some((item) => item.scopeStartDate <= targetDate && item.scopeEndDate >= targetDate)) {
      await onPlanChanged(targetDate);
    }
  }

  return async function processInbound(envelope) {
    if (!envelope.messageId || !recordInbound(database, envelope)) return { status: "duplicate" };
    try {
      const text = String(envelope.text || "").trim();
      if (!text) {
        mark(database, envelope, "ignored");
        return { status: "ignored" };
      }

      const members = listMembers(database);
      let member = findMemberBySender(database, envelope.senderId);
      const initial = parseCommand({ text, actorMemberId: member?.id || "unknown", targetDate: "2000-01-01" });

      if (!member) {
        if (initial.type === "link") {
          const selected = members[initial.memberNumber - 1];
          if (!selected) throw new Error(`Choose a member number from 1 to ${members.length}`);
          member = linkSenderToMember(database, {
            senderId: envelope.senderId,
            memberId: selected.id,
            pushName: envelope.pushName,
          });
          await reply(envelope.groupId, `${prefix}\n\nLinked this WhatsApp account to ${member.displayName}. Send change to begin.`);
          mark(database, envelope, "processed");
          return { status: "linked", member };
        }
        await reply(envelope.groupId, renderIdentityPrompt(members, prefix));
        mark(database, envelope, "processed");
        return { status: "identity_required" };
      }

      const targetDate = tomorrowDate({ now: now(), timeZone: config.household.timezone });
      const guided = handleGuidedMessage({
        database,
        groupId: envelope.groupId,
        member,
        text,
        prefix,
      });

      if (guided.handled) {
        if (guided.reply) await reply(envelope.groupId, guided.reply);
        if (guided.weeklyUpdate) {
          if (!member.isAdmin) throw new Error("Only an admin can change the weekly menu");
          updateWeeklyMenu(database, { actorMemberId: member.id, ...guided.weeklyUpdate });
          await reply(envelope.groupId, `${prefix}\n\nWeekly menu updated.`);
          await onPlanChanged(targetDate);
        }
        if (guided.commandText) {
          const parsed = parseCommand({ text: guided.commandText, actorMemberId: member.id, targetDate });
          await applyParsed(parsed, member, envelope, targetDate);
        }
        mark(database, envelope, "processed");
        return { status: "processed" };
      }

      const parsed = parseCommand({ text, actorMemberId: member.id, targetDate });
      await applyParsed(parsed, member, envelope, targetDate);
      mark(database, envelope, "processed");
      return { status: "processed" };
    } catch (error) {
      mark(database, envelope, "failed", error.message);
      try {
        await reply(envelope.groupId, `${prefix}\n\nI could not save that change: ${error.message}`);
      } catch {}
      return { status: "failed", error };
    }
  };
}
