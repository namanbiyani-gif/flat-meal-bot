const MEALS = ["lunch", "dinner"];
const LABELS = { lunch: "Lunch", dinner: "Dinner" };

function number(value) {
  const rounded = Math.round(Number(value || 0) * 100) / 100;
  return String(rounded);
}

function plural(quantity, singular, pluralForm) {
  return Number(quantity) === 1 ? singular : pluralForm;
}

function dateLabel(serviceDate) {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${serviceDate}T00:00:00Z`));
}

function carbDescription(type, quantity) {
  if (!type || type === "none" || Number(quantity) <= 0) return "";
  if (type === "roti") return `${number(quantity)} ${plural(quantity, "roti", "rotis")}`;
  if (type === "paratha") return `${number(quantity)} ${plural(quantity, "paratha", "parathas")}`;
  if (type === "rice") return `${number(quantity)} ${plural(quantity, "rice portion", "rice portions")}`;
  return `${number(quantity)} ${type}`;
}

function customDescription(item) {
  return [number(item.quantity), item.unit, item.label].filter(Boolean).join(" ");
}

function lineDescription(line) {
  if (!line.isParticipating) return "not eating";
  const parts = [];
  if (line.sharedDishPortions > 0) {
    parts.push(`${number(line.sharedDishPortions)} ${plural(line.sharedDishPortions, "dish portion", "dish portions")}`);
  }
  const carb = carbDescription(line.carb.type, line.carb.quantity);
  if (carb) parts.push(carb);
  for (const item of line.customItems) {
    if (item.quantity > 0) parts.push(customDescription(item));
  }
  return parts.length ? parts.join(", ") : "no fresh cooking";
}

function totalParts(totals, meal) {
  const parts = [];
  if (totals.sharedDishPortions > 0) {
    parts.push(`${number(totals.sharedDishPortions)} ${plural(totals.sharedDishPortions, "dish portion", "dish portions")} of ${meal.dishName}`);
  }
  const carb = carbDescription(meal.carbType, meal.carbType === "none" ? 0 : totals.carbs[meal.carbType]);
  if (carb) parts.push(carb);
  for (const item of totals.customItems) {
    if (item.quantity > 0) parts.push(customDescription(item));
  }
  return parts;
}

function botPrefix(materialized) {
  return materialized.household?.botPrefix || "[Meal Bot 🤖]";
}

export function renderOperationsSummary(materialized, { isUpdate = false, heading = "Plan review" } = {}) {
  const title = isUpdate ? "UPDATE" : heading;
  const output = [`${botPrefix(materialized)} ${title} — ${dateLabel(materialized.serviceDate)}`];

  for (const mealType of MEALS) {
    const meal = materialized.plan.menu[mealType];
    output.push("", `${LABELS[mealType]}: ${meal.dishName} + ${meal.carbType}`);
    for (const line of materialized.plan.lines.filter((entry) => entry.mealType === mealType)) {
      output.push(`• ${line.displayName}: ${lineDescription(line)}`);
    }
    const totals = totalParts(materialized.plan.totals[mealType], meal);
    output.push(`Total: ${totals.length ? totals.join(", ") : "no fresh cooking"}`);
  }

  if (materialized.cookNotes?.length) {
    output.push("", "Cook notes:");
    for (const item of materialized.cookNotes) {
      output.push(`• ${item.mealType === "both" ? "Both meals" : LABELS[item.mealType]}: ${item.note}`);
    }
  }

  return output.join("\n");
}

export function renderCookText(materialized) {
  const cookLabel = materialized.household?.cookLabel || "Cook";
  const output = [`${cookLabel}, here is the cooking plan for tomorrow:`];
  let hasCooking = false;

  for (const mealType of MEALS) {
    const meal = materialized.plan.menu[mealType];
    const parts = totalParts(materialized.plan.totals[mealType], meal);
    if (parts.length) hasCooking = true;
    output.push("", `${LABELS[mealType]}: ${parts.length ? parts.join("; ") : "no fresh cooking"}.`);
    if (meal.notes?.trim()) output.push(`Note: ${meal.notes.trim()}`);
    for (const note of materialized.cookNotes?.filter((item) => item.mealType === mealType || item.mealType === "both") || []) {
      output.push(`Note: ${note.note}`);
    }
  }

  if (!hasCooking) output.push("", "No fresh food needs to be prepared.");
  return output.join("\n");
}

export function renderHelp(prefix = "[Meal Bot 🤖]") {
  return [
    prefix,
    "",
    "Send change to open the guided menu, or use a shortcut:",
    "• no lunch",
    "• dinner leftovers",
    "• lunch 3 rotis",
    "• dinner dish 0.5",
    "• lunch item protein 150",
    "• guest lunch 2",
    "• vacation 2026-08-01 to 2026-08-05",
    "• menu dinner: Chickpeas | rice",
    "• cook note dinner: less spicy",
    "• confirm ABCD1234",
    "• undo ABCD1234",
  ].join("\n");
}

export function renderIdentityPrompt(members, prefix = "[Meal Bot 🤖]") {
  return [
    prefix,
    "",
    "I do not know which household member you are yet.",
    "Reply with link followed by your number:",
    "",
    ...members.map((member, index) => `${index + 1}. ${member.displayName}`),
    "",
    "Example: link 1",
  ].join("\n");
}
