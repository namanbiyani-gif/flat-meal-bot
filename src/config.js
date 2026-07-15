import fs from "node:fs";
import path from "node:path";

const MEALS = [
  "lunch",
  "dinner",
];

const CARB_TYPES = new Set([
  "roti",
  "rice",
  "paratha",
  "none",
]);

function fail(message) {
  throw new Error(
    `Invalid household configuration: ${message}`
  );
}

function assertObject(
  value,
  label
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(`${label} must be an object`);
  }
}

function assertString(
  value,
  label,
  {
    allowEmpty = false,
  } = {}
) {
  if (typeof value !== "string") {
    fail(`${label} must be a string`);
  }

  if (
    !allowEmpty &&
    value.trim() === ""
  ) {
    fail(`${label} cannot be empty`);
  }
}

function assertQuantity(
  value,
  label
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail(
      `${label} must be a non-negative number`
    );
  }
}

function assertTime(
  value,
  label
) {
  assertString(value, label);

  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(
      value
    )
  ) {
    fail(
      `${label} must use HH:MM`
    );
  }
}

function validateCustomItem(
  item,
  label
) {
  assertObject(item, label);
  assertString(item.key, `${label}.key`);
  assertString(
    item.label,
    `${label}.label`
  );
  assertQuantity(
    item.quantity,
    `${label}.quantity`
  );
  assertString(
    item.unit,
    `${label}.unit`
  );
}

function validateMealDefaults(
  defaults,
  label
) {
  assertObject(defaults, label);

  assertQuantity(
    defaults.sharedDishPortions,
    `${label}.sharedDishPortions`
  );

  assertObject(
    defaults.carbs,
    `${label}.carbs`
  );

  for (
    const carbType
    of ["roti", "paratha", "rice"]
  ) {
    assertQuantity(
      defaults.carbs[carbType],
      `${label}.carbs.${carbType}`
    );
  }

  if (
    !Array.isArray(
      defaults.customItems
    )
  ) {
    fail(
      `${label}.customItems must be an array`
    );
  }

  const itemKeys = new Set();

  defaults.customItems.forEach(
    (item, index) => {
      validateCustomItem(
        item,
        `${label}.customItems[${index}]`
      );

      if (
        itemKeys.has(item.key)
      ) {
        fail(
          `${label} contains duplicate custom item key ${item.key}`
        );
      }

      itemKeys.add(item.key);
    }
  );
}

function validateMember(
  member,
  index
) {
  const label =
    `members[${index}]`;

  assertObject(member, label);
  assertString(
    member.id,
    `${label}.id`
  );

  if (
    !/^[a-z0-9][a-z0-9_-]*$/.test(
      member.id
    )
  ) {
    fail(
      `${label}.id may contain only lowercase letters, numbers, hyphens and underscores`
    );
  }

  assertString(
    member.displayName,
    `${label}.displayName`
  );

  if (
    typeof member.isAdmin !==
    "boolean"
  ) {
    fail(
      `${label}.isAdmin must be boolean`
    );
  }

  if (
    !Array.isArray(
      member.whatsappSenderIds
    )
  ) {
    fail(
      `${label}.whatsappSenderIds must be an array`
    );
  }

  member.whatsappSenderIds.forEach(
    (senderId, senderIndex) =>
      assertString(
        senderId,
        `${label}.whatsappSenderIds[${senderIndex}]`
      )
  );

  assertObject(
    member.defaults,
    `${label}.defaults`
  );

  for (const mealType of MEALS) {
    validateMealDefaults(
      member.defaults[mealType],
      `${label}.defaults.${mealType}`
    );
  }
}

function validateWeeklyMenu(
  weeklyMenu
) {
  if (
    !Array.isArray(weeklyMenu)
  ) {
    fail(
      "weeklyMenu must be an array"
    );
  }

  if (weeklyMenu.length !== 7) {
    fail(
      "weeklyMenu must contain exactly seven weekdays"
    );
  }

  const weekdays = new Set();

  weeklyMenu.forEach(
    (day, index) => {
      const label =
        `weeklyMenu[${index}]`;

      assertObject(day, label);

      if (
        !Number.isInteger(
          day.weekday
        ) ||
        day.weekday < 1 ||
        day.weekday > 7
      ) {
        fail(
          `${label}.weekday must be an integer from 1 to 7`
        );
      }

      if (
        weekdays.has(day.weekday)
      ) {
        fail(
          `weeklyMenu contains duplicate weekday ${day.weekday}`
        );
      }

      weekdays.add(day.weekday);

      for (
        const mealType
        of MEALS
      ) {
        const meal =
          day[mealType];

        assertObject(
          meal,
          `${label}.${mealType}`
        );

        assertString(
          meal.dishName,
          `${label}.${mealType}.dishName`
        );

        if (
          !CARB_TYPES.has(
            meal.carbType
          )
        ) {
          fail(
            `${label}.${mealType}.carbType is invalid`
          );
        }
      }
    }
  );
}

export function validateHouseholdConfig(
  config,
  {
    allowIncompleteGroups =
      false,
  } = {}
) {
  assertObject(config, "config");

  if (config.schemaVersion !== 1) {
    fail(
      "schemaVersion must equal 1"
    );
  }

  assertObject(
    config.household,
    "household"
  );

  assertString(
    config.household.name,
    "household.name"
  );

  assertString(
    config.household.cookLabel,
    "household.cookLabel"
  );

  assertString(
    config.household.timezone,
    "household.timezone"
  );

  try {
    new Intl.DateTimeFormat("en", { timeZone: config.household.timezone }).format(new Date());
  } catch {
    fail("household.timezone must be a valid IANA timezone");
  }

  assertString(
    config.household.botPrefix,
    "household.botPrefix"
  );

  assertObject(
    config.groups,
    "groups"
  );

  for (
    const key
    of [
      "operationsGroupId",
      "cookGroupId",
    ]
  ) {
    assertString(
      config.groups[key],
      `groups.${key}`,
      {
        allowEmpty:
          allowIncompleteGroups,
      }
    );

    if (
      config.groups[key] &&
      !config.groups[key]
        .endsWith("@g.us")
    ) {
      fail(
        `groups.${key} must be a WhatsApp group ID`
      );
    }
  }

  assertObject(
    config.schedule,
    "schedule"
  );

  for (
    const key
    of [
      "menuAnnouncement",
      "reviewSummary",
      "lockPlan",
      "cookDelivery",
    ]
  ) {
    assertTime(
      config.schedule[key],
      `schedule.${key}`
    );
  }

  const scheduleMinutes = [
    config.schedule.menuAnnouncement,
    config.schedule.reviewSummary,
    config.schedule.lockPlan,
    config.schedule.cookDelivery,
  ].map((value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour * 60 + minute;
  });

  if (!scheduleMinutes.every((value, index) => index === 0 || value > scheduleMinutes[index - 1])) {
    fail("schedule times must be strictly increasing");
  }

  assertObject(
    config.voice,
    "voice"
  );

  if (
    typeof config.voice.enabled !==
    "boolean"
  ) {
    fail(
      "voice.enabled must be boolean"
    );
  }

  if (
    ![
      "macos-say",
      "none",
    ].includes(
      config.voice.provider
    )
  ) {
    fail(
      "voice.provider must be macos-say or none"
    );
  }

  assertString(
    config.voice.voice,
    "voice.voice"
  );

  assertQuantity(
    config.voice.speakingRate,
    "voice.speakingRate"
  );

  if (
    !Array.isArray(
      config.members
    ) ||
    config.members.length === 0
  ) {
    fail(
      "members must contain at least one member"
    );
  }

  const memberIds = new Set();
  const names = new Set();
  let adminCount = 0;

  config.members.forEach(
    (member, index) => {
      validateMember(
        member,
        index
      );

      if (
        memberIds.has(member.id)
      ) {
        fail(
          `duplicate member id ${member.id}`
        );
      }

      if (
        names.has(
          member.displayName
            .trim()
            .toLowerCase()
        )
      ) {
        fail(
          `duplicate member display name ${member.displayName}`
        );
      }

      memberIds.add(member.id);
      names.add(
        member.displayName
          .trim()
          .toLowerCase()
      );

      if (member.isAdmin) {
        adminCount += 1;
      }
    }
  );

  if (adminCount === 0) {
    fail(
      "at least one member must be an admin"
    );
  }

  assertObject(
    config.guestDefaults,
    "guestDefaults"
  );

  assertString(
    config.guestDefaults
      .copyFromMemberId,
    "guestDefaults.copyFromMemberId"
  );

  if (
    !memberIds.has(
      config.guestDefaults
        .copyFromMemberId
    )
  ) {
    fail(
      "guestDefaults.copyFromMemberId must reference an existing member"
    );
  }

  validateWeeklyMenu(
    config.weeklyMenu
  );

  return structuredClone(
    config
  );
}

export function loadHouseholdConfig(
  filePath = path.resolve(
    process.env.CONFIG_PATH ||
      "config/household.json"
  ),
  options = {}
) {
  if (
    !fs.existsSync(filePath)
  ) {
    throw new Error(
      `Household configuration not found: ${filePath}`
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch (error) {
    throw new Error(
      `Household configuration is not valid JSON: ${error.message}`
    );
  }

  return validateHouseholdConfig(
    parsed,
    options
  );
}
