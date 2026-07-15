import test from "node:test";
import assert from "node:assert/strict";
import { materializeDayPlan } from "../src/domain/materializer.js";
import { renderCookText, renderOperationsSummary } from "../src/domain/renderer.js";
import { updateMemberDefault, updateWeeklyMenu } from "../src/services/configuration.js";
import { createTestDatabase } from "./helpers.js";

test("personal defaults update generic database quantities", () => {
  const database = createTestDatabase();
  try {
    updateMemberDefault(database, {
      actorMemberId: "member-1",
      memberId: "member-1",
      mealType: "lunch",
      quantityType: "dish",
      value: 0.5,
    });
    const plan = materializeDayPlan(database, "2026-07-20");
    const line = plan.plan.lines.find((item) => item.subjectId === "member-1" && item.mealType === "lunch");
    assert.equal(line.sharedDishPortions, 0.5);
  } finally {
    database.close();
  }
});

test("admins can update regular weekly menu through audited configuration", () => {
  const database = createTestDatabase();
  try {
    updateWeeklyMenu(database, {
      actorMemberId: "member-1",
      weekday: 1,
      mealType: "lunch",
      dishName: "Updated vegetables",
      carbType: "rice",
    });
    const plan = materializeDayPlan(database, "2026-07-20");
    assert.equal(plan.plan.menu.lunch.dishName, "Updated vegetables");
    assert.equal(plan.plan.menu.lunch.carbType, "rice");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM configuration_audit").get().count, 1);
  } finally {
    database.close();
  }
});

test("cook renderer aggregates quantities without member names", () => {
  const database = createTestDatabase();
  try {
    const materialized = materializeDayPlan(database, "2026-07-20");
    const operations = renderOperationsSummary(materialized);
    const cook = renderCookText(materialized);
    assert.match(operations, /Member 1/);
    assert.match(cook, /Personal protein/);
    assert.doesNotMatch(cook, /Member 1|Member 2/);
  } finally {
    database.close();
  }
});
