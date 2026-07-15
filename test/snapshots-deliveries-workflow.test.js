import test from "node:test";
import assert from "node:assert/strict";
import { createChange } from "../src/domain/changes.js";
import { getDelivery, sendDelivery } from "../src/services/deliveries.js";
import { buildCurrentSnapshot, deliverCookPlan, handleLatePlanChange, lockCurrentPlan } from "../src/services/workflow.js";
import { createTestDatabase, fakeTransport } from "./helpers.js";

test("text deliveries retry without resending after success", async () => {
  const database = createTestDatabase();
  const transport = fakeTransport({ failTextOnce: true });
  try {
    const { snapshot } = buildCurrentSnapshot(database, "2026-07-20");
    await assert.rejects(sendDelivery(database, {
      snapshotId: snapshot.id,
      deliveryType: "operations_review",
      destinationGroupId: "111111@g.us",
      transport,
    }), /Temporary text failure/);
    assert.equal(getDelivery(database, snapshot.id, "operations_review").status, "failed");
    await sendDelivery(database, {
      snapshotId: snapshot.id,
      deliveryType: "operations_review",
      destinationGroupId: "111111@g.us",
      transport,
    });
    await sendDelivery(database, {
      snapshotId: snapshot.id,
      deliveryType: "operations_review",
      destinationGroupId: "111111@g.us",
      transport,
    });
    assert.equal(transport.calls.filter((call) => call.method === "text").length, 2);
    assert.equal(getDelivery(database, snapshot.id, "operations_review").attemptCount, 2);
  } finally {
    database.close();
  }
});

test("cook text and voice are independent idempotent deliveries", async () => {
  const database = createTestDatabase();
  const transport = fakeTransport();
  try {
    const locked = lockCurrentPlan(database, "2026-07-20");
    await deliverCookPlan(database, {
      serviceDate: "2026-07-20",
      cookGroupId: "222222@g.us",
      transport,
      voiceConfig: { enabled: true, provider: "macos-say", voice: "Test", speakingRate: 100 },
      audioDirectory: "/tmp",
      voiceGenerator: async () => "/tmp/test-voice.ogg",
    });
    await deliverCookPlan(database, {
      serviceDate: "2026-07-20",
      cookGroupId: "222222@g.us",
      transport,
      voiceConfig: { enabled: true, provider: "macos-say", voice: "Test", speakingRate: 100 },
      audioDirectory: "/tmp",
      voiceGenerator: async () => "/tmp/test-voice.ogg",
    });
    assert.ok(locked.id);
    assert.equal(transport.calls.filter((call) => call.method === "text").length, 1);
    assert.equal(transport.calls.filter((call) => call.method === "voice").length, 1);
  } finally {
    database.close();
  }
});

test("late changes replace locked cook instructions and delete old messages", async () => {
  const database = createTestDatabase();
  const transport = fakeTransport();
  try {
    const original = lockCurrentPlan(database, "2026-07-20");
    await deliverCookPlan(database, {
      serviceDate: "2026-07-20",
      cookGroupId: "222222@g.us",
      transport,
      voiceConfig: { enabled: false },
    });

    createChange(database, {
      actorMemberId: "member-1",
      targetMemberId: "member-1",
      actionType: "participation",
      actionKey: "2026-07-20:member-1:lunch:participation",
      scopeStartDate: "2026-07-20",
      scopeEndDate: "2026-07-20",
      mealType: "lunch",
      payload: { participating: false },
      householdImpact: false,
      requiresConfirmation: false,
    });

    const result = await handleLatePlanChange(database, {
      serviceDate: "2026-07-20",
      operationsGroupId: "111111@g.us",
      cookGroupId: "222222@g.us",
      transport,
      voiceConfig: { enabled: false },
    });

    assert.equal(result.updated, true);
    assert.notEqual(result.replacementSnapshotId, original.id);
    assert.equal(transport.calls.filter((call) => call.method === "delete").length, 1);
    assert.equal(transport.calls.filter((call) => call.method === "text").length, 3);
    assert.match(transport.calls.find((call) => call.deliveryType === undefined && call.purpose === "operations_update")?.text || transport.calls[1].text, /UPDATE/);
  } finally {
    database.close();
  }
});

test("late replacement voice is generated before old messages are deleted", async () => {
  const database = createTestDatabase();
  const order = [];
  const transport = fakeTransport();
  const originalDelete = transport.deleteMessage;
  transport.deleteMessage = async (payload) => {
    order.push("delete");
    return originalDelete(payload);
  };
  try {
    lockCurrentPlan(database, "2026-07-20");
    await deliverCookPlan(database, {
      serviceDate: "2026-07-20",
      cookGroupId: "222222@g.us",
      transport,
      voiceConfig: { enabled: true, provider: "macos-say", voice: "Test", speakingRate: 100 },
      voiceGenerator: async () => "/tmp/old.ogg",
    });
    createChange(database, {
      actorMemberId: "member-1",
      targetMemberId: "member-1",
      actionType: "quantity_override",
      actionKey: "2026-07-20:member-1:lunch:quantities",
      scopeStartDate: "2026-07-20",
      scopeEndDate: "2026-07-20",
      mealType: "lunch",
      payload: { carbQuantity: 4 },
      householdImpact: false,
      requiresConfirmation: false,
    });
    await handleLatePlanChange(database, {
      serviceDate: "2026-07-20",
      operationsGroupId: "111111@g.us",
      cookGroupId: "222222@g.us",
      transport,
      voiceConfig: { enabled: true, provider: "macos-say", voice: "Test", speakingRate: 100 },
      voiceGenerator: async () => {
        order.push("generate");
        return "/tmp/new.ogg";
      },
    });
    assert.equal(order[0], "generate");
    assert.ok(order.indexOf("delete") > order.indexOf("generate"));
  } finally {
    database.close();
  }
});
