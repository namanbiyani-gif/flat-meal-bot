import { createHash } from "node:crypto";
import { validateHouseholdConfig } from "../config.js";

const MEALS = ["lunch", "dinner"];

function hashConfig(config) {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function withTransaction(database, operation) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function insertSetting(database, key, value) {
  database.prepare(`
    INSERT INTO household_settings (key, value_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(key, JSON.stringify(value));
}

export function seedHouseholdConfig(database, inputConfig, options = {}) {
  const config = validateHouseholdConfig(inputConfig, options);
  const existing = database.prepare("SELECT COUNT(*) AS count FROM household_members").get().count;

  if (existing > 0 && options.replaceExisting !== true) {
    return { seeded: false, reason: "already_initialized", memberCount: existing };
  }

  return withTransaction(database, () => {
    if (existing > 0) {
      database.exec(`
        DELETE FROM member_whatsapp_identities;
        DELETE FROM member_custom_item_defaults;
        DELETE FROM member_meal_defaults;
        DELETE FROM weekly_menu_defaults;
        DELETE FROM household_members;
        DELETE FROM household_settings;
      `);
    }

    insertSetting(database, "schemaVersion", config.schemaVersion);
    insertSetting(database, "household", config.household);
    insertSetting(database, "groups", config.groups);
    insertSetting(database, "schedule", config.schedule);
    insertSetting(database, "voice", config.voice);
    insertSetting(database, "guestDefaults", config.guestDefaults);
    insertSetting(database, "configHash", hashConfig(config));

    const insertMember = database.prepare(`
      INSERT INTO household_members (id, display_name, is_admin, is_active)
      VALUES (?, ?, ?, 1)
    `);
    const insertIdentity = database.prepare(`
      INSERT INTO member_whatsapp_identities
        (sender_id, member_id, observed_push_name, is_active)
      VALUES (?, ?, '', 1)
    `);
    const insertDefaults = database.prepare(`
      INSERT INTO member_meal_defaults
        (member_id, meal_type, shared_dish_portions, roti_quantity, rice_quantity, paratha_quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertItem = database.prepare(`
      INSERT INTO member_custom_item_defaults
        (member_id, meal_type, item_key, item_label, quantity, unit)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const member of config.members) {
      insertMember.run(member.id, member.displayName, member.isAdmin ? 1 : 0);
      for (const senderId of member.whatsappSenderIds) {
        insertIdentity.run(senderId, member.id);
      }
      for (const mealType of MEALS) {
        const defaults = member.defaults[mealType];
        insertDefaults.run(
          member.id,
          mealType,
          defaults.sharedDishPortions,
          defaults.carbs.roti,
          defaults.carbs.rice,
          defaults.carbs.paratha
        );
        for (const item of defaults.customItems) {
          insertItem.run(member.id, mealType, item.key, item.label, item.quantity, item.unit);
        }
      }
    }

    const insertMenu = database.prepare(`
      INSERT INTO weekly_menu_defaults
        (weekday, meal_type, dish_name, carb_type, notes, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);
    for (const day of config.weeklyMenu) {
      for (const mealType of MEALS) {
        const meal = day[mealType];
        insertMenu.run(day.weekday, mealType, meal.dishName, meal.carbType, meal.notes || "");
      }
    }

    return {
      seeded: true,
      memberCount: config.members.length,
      menuEntryCount: config.weeklyMenu.length * MEALS.length,
      configHash: hashConfig(config),
    };
  });
}

function parseSetting(row) {
  return row ? JSON.parse(row.value_json) : null;
}

export function loadHousehold(database) {
  const settings = new Map(
    database.prepare("SELECT key, value_json FROM household_settings").all()
      .map((row) => [row.key, parseSetting(row)])
  );

  const identityQuery = database.prepare(`
    SELECT sender_id FROM member_whatsapp_identities
    WHERE member_id = ? AND is_active = 1 ORDER BY sender_id
  `);
  const defaultsQuery = database.prepare(`
    SELECT * FROM member_meal_defaults WHERE member_id = ? AND meal_type = ?
  `);
  const itemsQuery = database.prepare(`
    SELECT item_key, item_label, quantity, unit
    FROM member_custom_item_defaults
    WHERE member_id = ? AND meal_type = ? ORDER BY item_key
  `);

  const members = database.prepare(`
    SELECT id, display_name, is_admin
    FROM household_members WHERE is_active = 1 ORDER BY display_name
  `).all().map((row) => ({
    id: row.id,
    displayName: row.display_name,
    isAdmin: Boolean(row.is_admin),
    whatsappSenderIds: identityQuery.all(row.id).map((identity) => identity.sender_id),
    defaults: Object.fromEntries(MEALS.map((mealType) => {
      const defaults = defaultsQuery.get(row.id, mealType);
      if (!defaults) throw new Error(`Missing ${mealType} defaults for ${row.id}`);
      const customItems = itemsQuery.all(row.id, mealType).map((item) => ({
        key: item.item_key,
        label: item.item_label,
        quantity: item.quantity,
        unit: item.unit,
      }));
      return [mealType, {
        sharedDishPortions: defaults.shared_dish_portions,
        carbs: {
          roti: defaults.roti_quantity,
          rice: defaults.rice_quantity,
          paratha: defaults.paratha_quantity,
        },
        customItems,
      }];
    })),
  }));

  const menuByDay = new Map();
  for (const row of database.prepare(`
    SELECT weekday, meal_type, dish_name, carb_type, notes
    FROM weekly_menu_defaults WHERE is_active = 1
    ORDER BY weekday, meal_type
  `).all()) {
    const day = menuByDay.get(row.weekday) || { weekday: row.weekday };
    day[row.meal_type] = {
      dishName: row.dish_name,
      carbType: row.carb_type,
      notes: row.notes,
    };
    menuByDay.set(row.weekday, day);
  }

  return {
    schemaVersion: settings.get("schemaVersion"),
    household: settings.get("household"),
    groups: settings.get("groups"),
    schedule: settings.get("schedule"),
    voice: settings.get("voice"),
    guestDefaults: settings.get("guestDefaults"),
    configHash: settings.get("configHash"),
    members,
    weeklyMenu: [...menuByDay.values()],
  };
}
