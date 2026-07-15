const MEALS = ["lunch", "dinner"];

const CARB_TYPES = new Set([
  "roti",
  "rice",
  "paratha",
  "none",
]);

export function slugifyMemberId(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return slug || "member";
}

export function uniqueMemberId(
  preferred,
  existingIds
) {
  const base = slugifyMemberId(preferred);

  if (!existingIds.has(base)) {
    return base;
  }

  let suffix = 2;

  while (
    existingIds.has(`${base}-${suffix}`)
  ) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}

export function parseNonNegativeNumber(
  value,
  label
) {
  const parsed = Number(
    String(value).trim()
  );

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    throw new Error(
      `${label} must be a non-negative number`
    );
  }

  return parsed;
}

export function parsePositiveInteger(
  value,
  label
) {
  const parsed = Number(
    String(value).trim()
  );

  if (
    !Number.isInteger(parsed) ||
    parsed < 1
  ) {
    throw new Error(
      `${label} must be a positive integer`
    );
  }

  return parsed;
}

export function parseYesNo(
  value,
  defaultValue = false
) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return defaultValue;
  }

  if (["y", "yes"].includes(normalized)) {
    return true;
  }

  if (["n", "no"].includes(normalized)) {
    return false;
  }

  throw new Error(
    "Please answer yes or no"
  );
}

export function normalizeClockTime(
  value,
  label
) {
  const normalized = String(value || "")
    .trim();

  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(
      normalized
    )
  ) {
    throw new Error(
      `${label} must use HH:MM`
    );
  }

  return normalized;
}

export function normalizeCarbType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (!CARB_TYPES.has(normalized)) {
    throw new Error(
      "Carb type must be roti, rice, paratha, or none"
    );
  }

  return normalized;
}

export function starterWeeklyMenu() {
  return [
    {
      weekday: 1,
      lunch: {
        dishName: "Mixed vegetables",
        carbType: "roti",
      },
      dinner: {
        dishName: "Lentils",
        carbType: "rice",
      },
    },
    {
      weekday: 2,
      lunch: {
        dishName: "Vegetable curry",
        carbType: "roti",
      },
      dinner: {
        dishName: "Beans",
        carbType: "rice",
      },
    },
    {
      weekday: 3,
      lunch: {
        dishName: "Seasonal vegetables",
        carbType: "roti",
      },
      dinner: {
        dishName: "Chickpeas",
        carbType: "rice",
      },
    },
    {
      weekday: 4,
      lunch: {
        dishName: "Vegetable stir-fry",
        carbType: "roti",
      },
      dinner: {
        dishName: "Lentil curry",
        carbType: "rice",
      },
    },
    {
      weekday: 5,
      lunch: {
        dishName: "Mixed vegetables",
        carbType: "roti",
      },
      dinner: {
        dishName: "Bean curry",
        carbType: "rice",
      },
    },
    {
      weekday: 6,
      lunch: {
        dishName: "Vegetable curry",
        carbType: "roti",
      },
      dinner: {
        dishName: "Lentils",
        carbType: "rice",
      },
    },
    {
      weekday: 7,
      lunch: {
        dishName: "Stuffed flatbread",
        carbType: "paratha",
      },
      dinner: {
        dishName: "Yogurt curry",
        carbType: "rice",
      },
    },
  ];
}

function assertMealDefaults(
  defaults,
  label
) {
  if (
    !defaults ||
    typeof defaults !== "object"
  ) {
    throw new Error(
      `${label} is required`
    );
  }

  parseNonNegativeNumber(
    defaults.sharedDishPortions,
    `${label}.sharedDishPortions`
  );

  for (const carbType of [
    "roti",
    "rice",
    "paratha",
  ]) {
    parseNonNegativeNumber(
      defaults.carbs?.[carbType],
      `${label}.carbs.${carbType}`
    );
  }

  if (
    !Array.isArray(defaults.customItems)
  ) {
    throw new Error(
      `${label}.customItems must be an array`
    );
  }
}

export function buildSetupConfig({
  household,
  groups,
  schedule,
  voice,
  members,
  guestTemplateMemberId,
  weeklyMenu,
}) {
  if (
    !Array.isArray(members) ||
    members.length === 0
  ) {
    throw new Error(
      "At least one member is required"
    );
  }

  const ids = new Set();
  let hasAdmin = false;

  for (const member of members) {
    if (ids.has(member.id)) {
      throw new Error(
        `Duplicate member ID: ${member.id}`
      );
    }

    ids.add(member.id);
    hasAdmin ||= member.isAdmin === true;

    for (const mealType of MEALS) {
      assertMealDefaults(
        member.defaults[mealType],
        `${member.id}.${mealType}`
      );
    }
  }

  if (!hasAdmin) {
    throw new Error(
      "At least one member must be an admin"
    );
  }

  if (!ids.has(guestTemplateMemberId)) {
    throw new Error(
      "Guest template must reference a member"
    );
  }

  if (
    !Array.isArray(weeklyMenu) ||
    weeklyMenu.length !== 7
  ) {
    throw new Error(
      "Weekly menu must contain seven days"
    );
  }

  return {
    schemaVersion: 1,

    household: {
      name: household.name,
      cookLabel: household.cookLabel,
      timezone: household.timezone,
      botPrefix: household.botPrefix,
    },

    groups: {
      operationsGroupId:
        groups.operationsGroupId || "",
      cookGroupId:
        groups.cookGroupId || "",
    },

    schedule: {
      menuAnnouncement:
        normalizeClockTime(
          schedule.menuAnnouncement,
          "Menu announcement"
        ),
      reviewSummary:
        normalizeClockTime(
          schedule.reviewSummary,
          "Review summary"
        ),
      lockPlan:
        normalizeClockTime(
          schedule.lockPlan,
          "Plan lock"
        ),
      cookDelivery:
        normalizeClockTime(
          schedule.cookDelivery,
          "Cook delivery"
        ),
    },

    voice: {
      enabled: voice.enabled === true,
      provider:
        voice.enabled
          ? "macos-say"
          : "none",
      voice:
        voice.voice ||
        "System Default",
      speakingRate:
        parseNonNegativeNumber(
          voice.speakingRate,
          "Speaking rate"
        ),
    },

    members:
      structuredClone(members),

    guestDefaults: {
      copyFromMemberId:
        guestTemplateMemberId,
    },

    weeklyMenu:
      structuredClone(weeklyMenu),
  };
}
