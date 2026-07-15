import test from "node:test";
import assert from "node:assert/strict";
import { createInboundService } from "../src/services/inbound.js";
import { findMemberBySender } from "../src/services/identity.js";
import { materializeDayPlan } from "../src/domain/materializer.js";
import { createTestDatabase, exampleConfig, fakeTransport } from "./helpers.js";

function envelope(text, messageId = text) {
  return {
    groupId: "111111@g.us",
    messageId,
    senderId: "sender-one@lid",
    pushName: "Person One",
    fromMe: false,
    text,
  };
}

test("unknown senders can self-link and then save a change", async () => {
  const database = createTestDatabase();
  const transport = fakeTransport();
  const config = exampleConfig();
  let lateChecks = 0;
  const inbound = createInboundService({
    database,
    transport,
    config,
    now: () => new Date("2026-07-19T12:00:00Z"),
    onPlanChanged: async () => { lateChecks += 1; },
  });
  try {
    const unknown = await inbound(envelope("hello", "m1"));
    assert.equal(unknown.status, "identity_required");
    assert.match(transport.calls[0].text, /link 1/);

    const linked = await inbound(envelope("link 1", "m2"));
    assert.equal(linked.status, "linked");
    assert.equal(findMemberBySender(database, "sender-one@lid").id, "member-1");

    const saved = await inbound(envelope("no lunch", "m3"));
    assert.equal(saved.status, "processed");
    assert.equal(lateChecks, 1);
    const plan = materializeDayPlan(database, "2026-07-20");
    assert.equal(plan.plan.lines.find((line) => line.subjectId === "member-1" && line.mealType === "lunch").isParticipating, false);
  } finally {
    database.close();
  }
});

test("inbound message IDs are deduplicated", async () => {
  const database = createTestDatabase();
  const transport = fakeTransport();
  const inbound = createInboundService({
    database,
    transport,
    config: exampleConfig(),
    now: () => new Date("2026-07-19T12:00:00Z"),
  });
  try {
    await inbound(envelope("link 1", "same"));
    const duplicate = await inbound(envelope("link 1", "same"));
    assert.equal(duplicate.status, "duplicate");
  } finally {
    database.close();
  }
});
