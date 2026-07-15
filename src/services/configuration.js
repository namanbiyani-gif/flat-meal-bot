import { randomUUID } from "node:crypto";

const CARBS = new Set(["roti", "rice", "paratha", "none"]);
const MEALS = new Set(["lunch", "dinner"]);

function assertQuantity(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Quantity must be a non-negative number");
  }
}

function audit(database, actorMemberId, changeType, targetKey, oldValue, newValue) {
  database.prepare(`
    INSERT INTO configuration_audit
      (id, actor_member_id, change_type, target_key, old_value_json, new_value_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    actorMemberId,
    changeType,
    targetKey,
    oldValue == null ? null : JSON.stringify(oldValue),
    JSON.stringify(newValue)
  );
}

export function updateMemberDefault(database, {
  actorMemberId,
  memberId,
  mealType,
  quantityType,
  value,
  itemKey,
}) {
  if (!MEALS.has(mealType)) throw new Error("Meal must be lunch or dinner");
  assertQuantity(value);

  if (quantityType === "dish" || quantityType === "carb") {
    const row = database.prepare(`
      SELECT * FROM member_meal_defaults WHERE member_id = ? AND meal_type = ?
    `).get(memberId, mealType);
    if (!row) throw new Error("Member defaults not found");
    const oldValue = quantityType === "dish"
      ? row.shared_dish_portions
      : { roti: row.roti_quantity, rice: row.rice_quantity, paratha: row.paratha_quantity };

    database.exec("BEGIN IMMEDIATE");
    try {
      if (quantityType === "dish") {
        database.prepare(`
          UPDATE member_meal_defaults SET shared_dish_portions = ?, updated_at = CURRENT_TIMESTAMP
          WHERE member_id = ? AND meal_type = ?
        `).run(value, memberId, mealType);
      } else {
        database.prepare(`
          UPDATE member_meal_defaults SET
            roti_quantity = ?, rice_quantity = ?, paratha_quantity = ?, updated_at = CURRENT_TIMESTAMP
          WHERE member_id = ? AND meal_type = ?
        `).run(value, value, value, memberId, mealType);
      }
      audit(database, actorMemberId, "member_default", `${memberId}:${mealType}:${quantityType}`, oldValue, value);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return;
  }

  if (quantityType === "item") {
    if (!itemKey) throw new Error("Custom item key is required");
    const row = database.prepare(`
      SELECT item_label, quantity, unit FROM member_custom_item_defaults
      WHERE member_id = ? AND meal_type = ? AND item_key = ?
    `).get(memberId, mealType, itemKey);
    if (!row) throw new Error(`Unknown custom item: ${itemKey}`);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        UPDATE member_custom_item_defaults SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE member_id = ? AND meal_type = ? AND item_key = ?
      `).run(value, memberId, mealType, itemKey);
      audit(database, actorMemberId, "member_default", `${memberId}:${mealType}:item:${itemKey}`, row.quantity, value);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return;
  }

  throw new Error("Default type must be dish, carb, or item");
}

export function updateWeeklyMenu(database, {
  actorMemberId,
  weekday,
  mealType,
  dishName,
  carbType,
}) {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error("Weekday must be 1 to 7");
  if (!MEALS.has(mealType)) throw new Error("Meal must be lunch or dinner");
  if (!dishName?.trim()) throw new Error("Dish name is required");
  if (!CARBS.has(carbType)) throw new Error("Invalid carb type");
  const old = database.prepare(`
    SELECT dish_name, carb_type, notes FROM weekly_menu_defaults
    WHERE weekday = ? AND meal_type = ?
  `).get(weekday, mealType);
  if (!old) throw new Error("Weekly menu entry not found");

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      UPDATE weekly_menu_defaults SET dish_name = ?, carb_type = ?, updated_at = CURRENT_TIMESTAMP
      WHERE weekday = ? AND meal_type = ?
    `).run(dishName.trim(), carbType, weekday, mealType);
    audit(database, actorMemberId, "weekly_menu", `${weekday}:${mealType}`, old, { dishName: dishName.trim(), carbType });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
