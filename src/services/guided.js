import { listRecentChanges } from "../domain/changes.js";

const SESSION_MINUTES = 30;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function message(prefix, lines) {
  return `${prefix}\n\n${Array.isArray(lines) ? lines.join("\n") : lines}`;
}

function rootMenu(prefix, isAdmin) {
  const lines = [
    "What do you want to change?",
    "",
    "1. My meals tomorrow",
    "2. Guests tomorrow",
    "3. Tomorrow's shared menu",
    "4. I'll be away for some dates",
    "5. My usual meal defaults",
  ];
  if (isAdmin) lines.push("6. Weekly household menu");
  lines.push("7. Review or undo a change", "", "Reply with a number.");
  return message(prefix, lines);
}

function expiresAt() {
  return new Date(Date.now() + SESSION_MINUTES * 60 * 1000).toISOString();
}

function saveSession(database, groupId, memberId, step, state = {}) {
  database.prepare(`
    INSERT INTO guided_sessions (group_id, member_id, step, state_json, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(group_id, member_id) DO UPDATE SET
      step = excluded.step,
      state_json = excluded.state_json,
      expires_at = excluded.expires_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(groupId, memberId, step, JSON.stringify(state), expiresAt());
}

function clearSession(database, groupId, memberId) {
  database.prepare("DELETE FROM guided_sessions WHERE group_id = ? AND member_id = ?")
    .run(groupId, memberId);
}

function getSession(database, groupId, memberId) {
  const row = database.prepare(`
    SELECT step, state_json, expires_at FROM guided_sessions
    WHERE group_id = ? AND member_id = ?
  `).get(groupId, memberId);
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    clearSession(database, groupId, memberId);
    return null;
  }
  return { step: row.step, state: JSON.parse(row.state_json) };
}

function recentChangesText(database, memberId, prefix) {
  const changes = listRecentChanges(database, memberId, 8);
  if (!changes.length) return message(prefix, "No changes have been recorded yet.");
  return message(prefix, [
    "Recent changes:",
    "",
    ...changes.map((change) => `• ${change.reference} — ${change.status} — ${change.actionType} (${change.scopeStartDate})`),
    "",
    "Undo an active change with: undo REFERENCE",
  ]);
}

function parseWeekly(text) {
  const match = String(text).trim().match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(lunch|dinner)\s*:\s*(.+?)\s*\|\s*(roti|rice|paratha|none)$/i);
  if (!match) return null;
  return {
    weekday: DAYS.findIndex((day) => day.toLowerCase() === match[1].toLowerCase()) + 1,
    mealType: match[2].toLowerCase(),
    dishName: match[3].trim(),
    carbType: match[4].toLowerCase(),
  };
}

export function handleGuidedMessage({ database, groupId, member, text, prefix }) {
  const normalized = String(text || "").trim();
  const lower = normalized.toLowerCase();
  let session = getSession(database, groupId, member.id);

  if (["change", "menu"].includes(lower) || !session) {
    if (["change", "menu"].includes(lower)) {
      saveSession(database, groupId, member.id, "root");
      return { handled: true, reply: rootMenu(prefix, member.isAdmin) };
    }
    return { handled: false };
  }

  if (lower === "cancel" || lower === "0") {
    clearSession(database, groupId, member.id);
    return { handled: true, reply: message(prefix, "Guided change cancelled.") };
  }

  if (session.step === "root") {
    if (normalized === "1") {
      saveSession(database, groupId, member.id, "personal");
      return { handled: true, reply: message(prefix, [
        "Describe your personal change:", "",
        "• lunch skip", "• dinner leftovers", "• lunch carb 3",
        "• dinner dish 0.5", "• lunch item protein 150", "• lunch include",
      ]) };
    }
    if (normalized === "2") {
      saveSession(database, groupId, member.id, "guest");
      return { handled: true, reply: message(prefix, "Reply with the meal and guest count, for example: lunch 2") };
    }
    if (normalized === "3") {
      saveSession(database, groupId, member.id, "shared");
      return { handled: true, reply: message(prefix, "Reply like: dinner: Chickpeas | rice\nThis requires confirmation.") };
    }
    if (normalized === "4") {
      saveSession(database, groupId, member.id, "vacation");
      return { handled: true, reply: message(prefix, "Reply with dates like: 2026-08-01 to 2026-08-05") };
    }
    if (normalized === "5") {
      saveSession(database, groupId, member.id, "defaults");
      return { handled: true, reply: message(prefix, [
        "Change a usual default:", "", "• lunch carb 3", "• dinner dish 0.5", "• lunch item protein 150",
      ]) };
    }
    if (normalized === "6" && member.isAdmin) {
      saveSession(database, groupId, member.id, "weekly");
      return { handled: true, reply: message(prefix, "Reply like: Monday lunch: Mixed vegetables | roti") };
    }
    if (normalized === "7") {
      clearSession(database, groupId, member.id);
      return { handled: true, reply: recentChangesText(database, member.id, prefix) };
    }
    return { handled: true, reply: rootMenu(prefix, member.isAdmin) };
  }

  if (session.step === "personal") {
    clearSession(database, groupId, member.id);
    const match = lower.match(/^(lunch|dinner)\s+(skip|include|leftovers)$/);
    if (match) {
      const suffix = match[2] === "skip" ? `no ${match[1]}` : match[2] === "include" ? `include ${match[1]}` : `${match[1]} leftovers`;
      return { handled: true, commandText: suffix };
    }
    const quantity = lower.match(/^(lunch|dinner)\s+(carb|dish)\s+([0-9]+(?:\.[0-9]+)?)$/);
    if (quantity) return { handled: true, commandText: `${quantity[1]} ${quantity[2]} ${quantity[3]}` };
    const item = lower.match(/^(lunch|dinner)\s+item\s+([a-z0-9_-]+)\s+([0-9]+(?:\.[0-9]+)?)$/);
    if (item) return { handled: true, commandText: `${item[1]} item ${item[2]} ${item[3]}` };
    return { handled: true, reply: message(prefix, "I could not read that personal change. Send change to try again.") };
  }

  if (session.step === "guest") {
    clearSession(database, groupId, member.id);
    return { handled: true, commandText: `guest ${normalized}` };
  }

  if (session.step === "shared") {
    clearSession(database, groupId, member.id);
    return { handled: true, commandText: `menu ${normalized}` };
  }

  if (session.step === "vacation") {
    clearSession(database, groupId, member.id);
    return { handled: true, commandText: `vacation ${normalized}` };
  }

  if (session.step === "defaults") {
    clearSession(database, groupId, member.id);
    return { handled: true, commandText: `default ${normalized}` };
  }

  if (session.step === "weekly") {
    const update = parseWeekly(normalized);
    if (!update) {
      return { handled: true, reply: message(prefix, "Use: Monday lunch: Mixed vegetables | roti") };
    }
    saveSession(database, groupId, member.id, "weekly_confirm", update);
    return { handled: true, reply: message(prefix, [
      "Please confirm this permanent weekly-menu change:", "",
      `${DAYS[update.weekday - 1]} ${update.mealType}: ${update.dishName} | ${update.carbType}`,
      "", "1. Confirm", "2. Cancel",
    ]) };
  }

  if (session.step === "weekly_confirm") {
    clearSession(database, groupId, member.id);
    if (normalized === "1") return { handled: true, weeklyUpdate: session.state };
    return { handled: true, reply: message(prefix, "Weekly-menu change cancelled.") };
  }

  clearSession(database, groupId, member.id);
  return { handled: true, reply: rootMenu(prefix, member.isAdmin) };
}
