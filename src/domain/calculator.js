const MEAL_TYPES = [
  "lunch",
  "dinner",
];

const CARB_TYPES = new Set([
  "roti",
  "rice",
  "paratha",
  "none",
]);

function round(value) {
  return (
    Math.round(
      Number(value) * 10000
    ) / 10000
  );
}

function assertDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    throw new Error(
      "serviceDate must use YYYY-MM-DD"
    );
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
    throw new Error(
      `${label} must be a non-negative number`
    );
  }
}

function assertMenu(menu) {
  for (const mealType of MEAL_TYPES) {
    const meal =
      menu?.[mealType];

    if (!meal) {
      throw new Error(
        `Missing menu for ${mealType}`
      );
    }

    if (
      typeof meal.dishName !==
        "string" ||
      meal.dishName.trim() === ""
    ) {
      throw new Error(
        `Missing dish name for ${mealType}`
      );
    }

    if (
      !CARB_TYPES.has(
        meal.carbType
      )
    ) {
      throw new Error(
        `Invalid carb type for ${mealType}: ${meal.carbType}`
      );
    }
  }
}

function normalizeCustomItems(
  items,
  label
) {
  if (!Array.isArray(items)) {
    throw new Error(
      `${label} must be an array`
    );
  }

  const seen = new Set();

  return items.map(
    (item, index) => {
      const itemLabel =
        `${label}[${index}]`;

      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item)
      ) {
        throw new Error(
          `${itemLabel} must be an object`
        );
      }

      for (
        const key
        of ["key", "label", "unit"]
      ) {
        if (
          typeof item[key] !==
            "string" ||
          item[key].trim() === ""
        ) {
          throw new Error(
            `${itemLabel}.${key} must be non-empty`
          );
        }
      }

      assertQuantity(
        item.quantity,
        `${itemLabel}.quantity`
      );

      if (seen.has(item.key)) {
        throw new Error(
          `${label} contains duplicate key ${item.key}`
        );
      }

      seen.add(item.key);

      return {
        key: item.key,
        label: item.label,
        unit: item.unit,
        quantity:
          round(item.quantity),
      };
    }
  );
}

function memberDefaults(
  member,
  mealType,
  carbType
) {
  const defaults =
    member.defaults?.[mealType];

  if (!defaults) {
    throw new Error(
      `Missing ${mealType} defaults for ${member.id}`
    );
  }

  assertQuantity(
    defaults.sharedDishPortions,
    `${member.id}.${mealType}.sharedDishPortions`
  );

  const carbQuantity =
    carbType === "none"
      ? 0
      : defaults.carbs?.[
          carbType
        ];

  if (carbType !== "none") {
    assertQuantity(
      carbQuantity,
      `${member.id}.${mealType}.carbs.${carbType}`
    );
  }

  return {
    sharedDishPortions:
      round(
        defaults
          .sharedDishPortions
      ),

    carb: {
      type: carbType,
      quantity:
        round(
          carbQuantity || 0
        ),
    },

    customItems:
      normalizeCustomItems(
        defaults.customItems || [],
        `${member.id}.${mealType}.customItems`
      ),
  };
}

function applyCustomItemOverrides(
  baseItems,
  override
) {
  const byKey = new Map(
    baseItems.map(
      (item) => [
        item.key,
        { ...item },
      ]
    )
  );

  for (
    const key
    of override.removeCustomItems ||
      []
  ) {
    byKey.delete(key);
  }

  const customOverrides =
    override.customItems || {};

  if (
    !customOverrides ||
    typeof customOverrides !==
      "object" ||
    Array.isArray(customOverrides)
  ) {
    throw new Error(
      "customItems override must be an object"
    );
  }

  for (
    const [
      key,
      value,
    ] of Object.entries(
      customOverrides
    )
  ) {
    if (
      typeof value === "number"
    ) {
      assertQuantity(
        value,
        `customItems.${key}`
      );

      const existing =
        byKey.get(key);

      if (!existing) {
        throw new Error(
          `Custom item ${key} needs label and unit when it is not in the defaults`
        );
      }

      existing.quantity =
        round(value);

      continue;
    }

    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new Error(
        `Invalid custom item override for ${key}`
      );
    }

    const existing =
      byKey.get(key);

    const label =
      value.label ||
      existing?.label;

    const unit =
      value.unit ||
      existing?.unit;

    const quantity =
      value.quantity;

    if (
      typeof label !== "string" ||
      label.trim() === "" ||
      typeof unit !== "string" ||
      unit.trim() === ""
    ) {
      throw new Error(
        `Custom item ${key} requires label and unit`
      );
    }

    assertQuantity(
      quantity,
      `customItems.${key}.quantity`
    );

    byKey.set(
      key,
      {
        key,
        label,
        unit,
        quantity:
          round(quantity),
      }
    );
  }

  return [
    ...byKey.values(),
  ].filter(
    (item) =>
      item.quantity > 0
  );
}

function applyMealOverride(
  base,
  override = {}
) {
  const updated = {
    sharedDishPortions:
      base.sharedDishPortions,

    carb: {
      ...base.carb,
    },

    customItems:
      base.customItems.map(
        (item) => ({
          ...item,
        })
      ),
  };

  if (
    Object.prototype
      .hasOwnProperty.call(
        override,
        "sharedDishPortions"
      )
  ) {
    assertQuantity(
      override.sharedDishPortions,
      "sharedDishPortions override"
    );

    updated.sharedDishPortions =
      round(
        override
          .sharedDishPortions
      );
  }

  if (
    Object.prototype
      .hasOwnProperty.call(
        override,
        "carbQuantity"
      )
  ) {
    assertQuantity(
      override.carbQuantity,
      "carbQuantity override"
    );

    updated.carb.quantity =
      round(
        override.carbQuantity
      );
  }

  updated.customItems =
    applyCustomItemOverrides(
      updated.customItems,
      override
    );

  return updated;
}

function emptyLineQuantities(
  carbType
) {
  return {
    sharedDishPortions: 0,

    carb: {
      type: carbType,
      quantity: 0,
    },

    customItems: [],
  };
}

function lineForSubject({
  subjectType,
  subject,
  mealType,
  menu,
  participating,
  override,
}) {
  const meal =
    menu[mealType];

  if (!participating) {
    return {
      subjectType,
      subjectId: subject.id,
      displayName:
        subject.displayName,
      mealType,
      dishName:
        meal.dishName,
      carbType:
        meal.carbType,
      isParticipating: false,
      ...emptyLineQuantities(
        meal.carbType
      ),
      explanation:
        `${subject.displayName} is not participating in ${mealType}.`,
    };
  }

  const defaults =
    memberDefaults(
      subject,
      mealType,
      meal.carbType
    );

  const quantities =
    applyMealOverride(
      defaults,
      override
    );

  return {
    subjectType,
    subjectId: subject.id,
    displayName:
      subject.displayName,
    mealType,
    dishName:
      meal.dishName,
    carbType:
      meal.carbType,
    isParticipating: true,
    ...quantities,
    explanation:
      `Configured defaults applied for ${subject.displayName}.`,
  };
}

function emptyTotals() {
  return {
    sharedDishPortions: 0,

    carbs: {
      roti: 0,
      rice: 0,
      paratha: 0,
    },

    customItems: [],
  };
}

function sumLines(lines) {
  const totals =
    emptyTotals();

  const customItems =
    new Map();

  for (const line of lines) {
    totals.sharedDishPortions +=
      line.sharedDishPortions;

    if (
      line.carb.type !==
      "none"
    ) {
      totals.carbs[
        line.carb.type
      ] +=
        line.carb.quantity;
    }

    for (
      const item
      of line.customItems
    ) {
      const existing =
        customItems.get(
          item.key
        );

      if (
        existing &&
        (
          existing.label !==
            item.label ||
          existing.unit !==
            item.unit
        )
      ) {
        throw new Error(
          `Custom item ${item.key} uses inconsistent label or unit`
        );
      }

      customItems.set(
        item.key,
        {
          key: item.key,
          label: item.label,
          unit: item.unit,
          quantity:
            round(
              (
                existing?.quantity ||
                0
              ) +
                item.quantity
            ),
        }
      );
    }
  }

  totals.sharedDishPortions =
    round(
      totals
        .sharedDishPortions
    );

  for (
    const carbType
    of [
      "roti",
      "rice",
      "paratha",
    ]
  ) {
    totals.carbs[carbType] =
      round(
        totals.carbs[
          carbType
        ]
      );
  }

  totals.customItems = [
    ...customItems.values(),
  ]
    .filter(
      (item) =>
        item.quantity > 0
    )
    .sort(
      (left, right) =>
        left.key.localeCompare(
          right.key
        )
    );

  return totals;
}

export function calculateTotals(
  lines
) {
  return {
    lunch:
      sumLines(
        lines.filter(
          (line) =>
            line.mealType ===
            "lunch"
        )
      ),

    dinner:
      sumLines(
        lines.filter(
          (line) =>
            line.mealType ===
            "dinner"
        )
      ),

    day:
      sumLines(lines),
  };
}

function comparableTotals(
  totals
) {
  return JSON.stringify({
    sharedDishPortions:
      totals.sharedDishPortions,

    carbs:
      totals.carbs,

    customItems:
      [...totals.customItems]
        .sort(
          (left, right) =>
            left.key.localeCompare(
              right.key
            )
        ),
  });
}

export function assertPlanReconciles(
  plan
) {
  const recalculated =
    calculateTotals(
      plan.lines
    );

  for (
    const scope
    of [
      "lunch",
      "dinner",
      "day",
    ]
  ) {
    if (
      comparableTotals(
        recalculated[scope]
      ) !==
      comparableTotals(
        plan.totals[scope]
      )
    ) {
      throw new Error(
        `Plan reconciliation failed for ${scope}`
      );
    }
  }

  return true;
}

function resolveGuestTemplate(
  guest,
  membersById,
  guestDefaults
) {
  const templateId =
    guest.copyFromMemberId ||
    guestDefaults
      ?.copyFromMemberId;

  const template =
    membersById.get(
      templateId
    );

  if (!template) {
    throw new Error(
      `Guest template member not found: ${templateId}`
    );
  }

  return {
    id: guest.id,
    displayName:
      guest.displayName,
    defaults:
      structuredClone(
        template.defaults
      ),
  };
}

export function calculateDayPlan({
  serviceDate,
  menu,
  members,
  guestDefaults,
  memberParticipation = {},
  memberOverrides = {},
  guests = [],
}) {
  assertDate(serviceDate);
  assertMenu(menu);

  if (
    !Array.isArray(members) ||
    members.length === 0
  ) {
    throw new Error(
      "At least one member is required"
    );
  }

  const membersById =
    new Map();

  for (const member of members) {
    if (
      !member?.id ||
      !member?.displayName
    ) {
      throw new Error(
        "Every member requires id and displayName"
      );
    }

    if (
      membersById.has(
        member.id
      )
    ) {
      throw new Error(
        `Duplicate member id: ${member.id}`
      );
    }

    membersById.set(
      member.id,
      member
    );
  }

  const memberLines =
    members.flatMap(
      (member) =>
        MEAL_TYPES.map(
          (mealType) =>
            lineForSubject({
              subjectType:
                "member",
              subject: member,
              mealType,
              menu,
              participating:
                memberParticipation
                  ?.[member.id]
                  ?.[mealType] !==
                false,
              override:
                memberOverrides
                  ?.[member.id]
                  ?.[mealType] ||
                {},
            })
        )
    );

  const guestLines =
    guests.flatMap(
      (guest) => {
        if (
          !guest?.id ||
          !guest?.displayName
        ) {
          throw new Error(
            "Every guest requires id and displayName"
          );
        }

        const subject =
          resolveGuestTemplate(
            guest,
            membersById,
            guestDefaults
          );

        return MEAL_TYPES.map(
          (mealType) =>
            lineForSubject({
              subjectType:
                "guest",
              subject,
              mealType,
              menu,
              participating:
                guest.meals
                  ?.[mealType] ===
                true,
              override:
                guest.overrides
                  ?.[mealType] ||
                {},
            })
        );
      }
    );

  const lines = [
    ...memberLines,
    ...guestLines,
  ];

  const plan = {
    serviceDate,
    menu:
      structuredClone(menu),
    lines,
    totals:
      calculateTotals(
        lines
      ),
  };

  assertPlanReconciles(
    plan
  );

  return plan;
}
