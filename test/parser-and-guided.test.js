import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../src/services/parser.js";
import { handleGuidedMessage } from "../src/services/guided.js";
import { createTestDatabase } from "./helpers.js";

const context = { actorMemberId: "member-1", targetDate: "2026-07-20" };

test("parser understands personal and household shortcuts", () => {
  assert.equal(parseCommand({ ...context, text: "no lunch" }).actions[0].actionType, "participation");
  assert.equal(parseCommand({ ...context, text: "dinner leftovers" }).actions[0].payload.fullLeftovers, true);
  assert.equal(parseCommand({ ...context, text: "lunch item personal-protein 150" }).actions[0].payload.customItems["personal-protein"], 150);
  assert.equal(parseCommand({ ...context, text: "guest lunch 2" }).actions[0].requiresConfirmation, true);
  assert.equal(parseCommand({ ...context, text: "menu dinner: Chickpeas | rice" }).actions[0].actionType, "menu_override");
});

test("guided menu translates numbered flows into commands", () => {
  const database = createTestDatabase();
  try {
    const member = { id: "member-1", displayName: "Member 1", isAdmin: true };
    const root = handleGuidedMessage({ database, groupId: "111111@g.us", member, text: "change", prefix: "[Meal Bot]" });
    assert.match(root.reply, /What do you want to change/);
    const choose = handleGuidedMessage({ database, groupId: "111111@g.us", member, text: "1", prefix: "[Meal Bot]" });
    assert.match(choose.reply, /personal change/);
    const result = handleGuidedMessage({ database, groupId: "111111@g.us", member, text: "lunch skip", prefix: "[Meal Bot]" });
    assert.equal(result.commandText, "no lunch");
  } finally {
    database.close();
  }
});
