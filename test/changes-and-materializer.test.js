import test from "node:test";
import assert from "node:assert/strict";
import { createChange, confirmChange, undoChange } from "../src/domain/changes.js";
import { materializeDayPlan } from "../src/domain/materializer.js";
import { createTestDatabase } from "./helpers.js";

function personalChange(overrides = {}) {
  return {
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
    ...overrides,
  };
}

test("personal changes apply immediately and can be undone", () => {
  const database = createTestDatabase();
  try {
    const saved = createChange(database, personalChange());
    let plan = materializeDayPlan(database, "2026-07-20");
    assert.equal(plan.plan.lines.find((line) => line.subjectId === "member-1" && line.mealType === "lunch").isParticipating, false);
    undoChange(database, saved.reference);
    plan = materializeDayPlan(database, "2026-07-20");
    assert.equal(plan.plan.lines.find((line) => line.subjectId === "member-1" && line.mealType === "lunch").isParticipating, true);
  } finally {
    database.close();
  }
});

test("household menu changes require confirmation", () => {
  const database = createTestDatabase();
  try {
    const pending = createChange(database, {
      actorMemberId: "member-1",
      targetMemberId: null,
      actionType: "menu_override",
      actionKey: "2026-07-20:lunch:menu",
      scopeStartDate: "2026-07-20",
      scopeEndDate: "2026-07-20",
      mealType: "lunch",
      payload: { dishName: "New dish", carbType: "rice" },
      householdImpact: true,
      requiresConfirmation: true,
    });
    assert.equal(pending.status, "pending");
    assert.notEqual(materializeDayPlan(database, "2026-07-20").plan.menu.lunch.dishName, "New dish");
    confirmChange(database, pending.reference, "member-1");
    assert.equal(materializeDayPlan(database, "2026-07-20").plan.menu.lunch.dishName, "New dish");
  } finally {
    database.close();
  }
});

test("generic quantity, custom-item, guest and leftover changes materialize", () => {
  const database = createTestDatabase();
  try {
    createChange(database, personalChange({
      actionType: "quantity_override",
      actionKey: "2026-07-20:member-2:lunch:quantities",
      targetMemberId: "member-2",
      payload: { customItems: { "personal-protein": 150 } },
    }));
    const guest = createChange(database, {
      actorMemberId: "member-1",
      targetMemberId: null,
      actionType: "guest_count",
      actionKey: "2026-07-20:member-1:lunch:guests",
      scopeStartDate: "2026-07-20",
      scopeEndDate: "2026-07-20",
      mealType: "lunch",
      payload: { ownerMemberId: "member-1", count: 1 },
      householdImpact: true,
      requiresConfirmation: true,
    });
    confirmChange(database, guest.reference, "member-1");
    const plan = materializeDayPlan(database, "2026-07-20");
    assert.equal(plan.plan.lines.filter((line) => line.subjectType === "guest").length, 2);
    assert.equal(plan.plan.totals.lunch.customItems.find((item) => item.key === "personal-protein").quantity, 150);
    assert.equal(plan.plan.totals.lunch.carbs.roti, 4);
  } finally {
    database.close();
  }
});
