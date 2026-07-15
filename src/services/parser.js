const MEALS = new Set(["lunch", "dinner", "both"]);
const CARBS = new Set(["roti", "rice", "paratha", "none"]);

function clean(text) {
  return String(text || "").trim().replace(/\s+/g, " ").replace(/^tomorrow\s+/i, "").replace(/\s+tomorrow$/i, "");
}

function action(input) {
  return {
    type: "action",
    actions: Array.isArray(input) ? input : [input],
  };
}

function participation(actorMemberId, targetDate, mealType, participating) {
  return {
    actorMemberId,
    targetMemberId: actorMemberId,
    actionType: "participation",
    actionKey: `${targetDate}:${actorMemberId}:${mealType}:participation`,
    scopeStartDate: targetDate,
    scopeEndDate: targetDate,
    mealType,
    payload: { participating },
    householdImpact: false,
    requiresConfirmation: false,
    summary: `${participating ? "Include" : "Skip"} ${mealType === "both" ? "lunch and dinner" : mealType} on ${targetDate}.`,
  };
}

function quantity(actorMemberId, targetDate, mealType, payload, summary) {
  return {
    actorMemberId,
    targetMemberId: actorMemberId,
    actionType: "quantity_override",
    actionKey: `${targetDate}:${actorMemberId}:${mealType}:quantities`,
    scopeStartDate: targetDate,
    scopeEndDate: targetDate,
    mealType,
    payload,
    householdImpact: false,
    requiresConfirmation: false,
    summary,
  };
}

function numberValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Quantity must be a non-negative number");
  return parsed;
}

function parseOne({ text, actorMemberId, targetDate }) {
  const normalized = clean(text);
  const lower = normalized.toLowerCase();

  if (["help", "menu", "change"].includes(lower)) return { type: lower === "help" ? "help" : "guided" };

  const link = lower.match(/^link\s+(\d+)$/);
  if (link) return { type: "link", memberNumber: Number(link[1]) };

  const control = lower.match(/^(confirm|cancel|undo)\s+([a-z0-9]+)$/i);
  if (control) return { type: "control", control: control[1], reference: control[2].toUpperCase() };

  const skip = lower.match(/^(?:no|skip)(?: my)? (lunch|dinner|both|meals)$/);
  if (skip) return action(participation(actorMemberId, targetDate, skip[1] === "meals" ? "both" : skip[1], false));

  const include = lower.match(/^(?:include|eat|have)(?: my)? (lunch|dinner|both)$/);
  if (include) return action(participation(actorMemberId, targetDate, include[1], true));

  const leftovers = lower.match(/^(lunch|dinner) (?:full )?leftovers?$/) || lower.match(/^leftovers? (lunch|dinner)$/);
  if (leftovers) {
    return action(quantity(actorMemberId, targetDate, leftovers[1], { fullLeftovers: true }, `Use full leftovers for ${leftovers[1]} on ${targetDate}.`));
  }

  const carbQuantity = lower.match(/^(lunch|dinner)\s+(?:carb\s+)?([0-9]+(?:\.[0-9]+)?)\s*(?:rotis?|parathas?|rice(?: portions?)?)$/)
    || lower.match(/^(lunch|dinner)\s+carb\s+([0-9]+(?:\.[0-9]+)?)$/);
  if (carbQuantity) {
    const value = numberValue(carbQuantity[2]);
    return action(quantity(actorMemberId, targetDate, carbQuantity[1], { carbQuantity: value }, `Set ${carbQuantity[1]} carb quantity to ${value} on ${targetDate}.`));
  }

  const dishQuantity = lower.match(/^(lunch|dinner)\s+(?:dish|sabzi|dal)\s+([0-9]+(?:\.[0-9]+)?)$/);
  if (dishQuantity) {
    const value = numberValue(dishQuantity[2]);
    return action(quantity(actorMemberId, targetDate, dishQuantity[1], { sharedDishPortions: value }, `Set ${dishQuantity[1]} dish quantity to ${value} on ${targetDate}.`));
  }

  const itemQuantity = normalized.match(/^(lunch|dinner)\s+item\s+([a-z0-9_-]+)\s+([0-9]+(?:\.[0-9]+)?)$/i);
  if (itemQuantity) {
    const value = numberValue(itemQuantity[3]);
    const key = itemQuantity[2].toLowerCase();
    return action(quantity(actorMemberId, targetDate, itemQuantity[1].toLowerCase(), { customItems: { [key]: value } }, `Set ${itemQuantity[1].toLowerCase()} ${key} to ${value} on ${targetDate}.`));
  }

  const guest = lower.match(/^guests?\s+(lunch|dinner)\s+(\d+)$/);
  if (guest) {
    const count = Number(guest[2]);
    return action({
      actorMemberId,
      targetMemberId: null,
      actionType: "guest_count",
      actionKey: `${targetDate}:${actorMemberId}:${guest[1]}:guests`,
      scopeStartDate: targetDate,
      scopeEndDate: targetDate,
      mealType: guest[1],
      payload: { ownerMemberId: actorMemberId, count },
      householdImpact: true,
      requiresConfirmation: true,
      summary: `Add ${count} guest${count === 1 ? "" : "s"} for ${guest[1]} on ${targetDate}.`,
    });
  }

  const vacation = lower.match(/^vacation\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/);
  if (vacation) {
    return action({
      actorMemberId,
      targetMemberId: actorMemberId,
      actionType: "vacation",
      actionKey: `${actorMemberId}:vacation:${vacation[1]}:${vacation[2]}`,
      scopeStartDate: vacation[1],
      scopeEndDate: vacation[2],
      mealType: "both",
      payload: { participating: false },
      householdImpact: false,
      requiresConfirmation: false,
      summary: `Skip lunch and dinner from ${vacation[1]} through ${vacation[2]}.`,
    });
  }

  const menuOverride = normalized.match(/^menu\s+(lunch|dinner)\s*:\s*(.+?)\s*\|\s*(roti|rice|paratha|none)$/i);
  if (menuOverride) {
    const mealType = menuOverride[1].toLowerCase();
    const carbType = menuOverride[3].toLowerCase();
    if (!CARBS.has(carbType)) throw new Error("Invalid carb type");
    return action({
      actorMemberId,
      targetMemberId: null,
      actionType: "menu_override",
      actionKey: `${targetDate}:${mealType}:menu`,
      scopeStartDate: targetDate,
      scopeEndDate: targetDate,
      mealType,
      payload: { dishName: menuOverride[2].trim(), carbType },
      householdImpact: true,
      requiresConfirmation: true,
      summary: `Change tomorrow's ${mealType} to ${menuOverride[2].trim()} with ${carbType}.`,
    });
  }

  const note = normalized.match(/^cook note\s+(lunch|dinner|both)\s*:\s*(.+)$/i);
  if (note) {
    const mealType = note[1].toLowerCase();
    return action({
      actorMemberId,
      targetMemberId: null,
      actionType: "cook_note",
      actionKey: `${targetDate}:${mealType}:cook-note`,
      scopeStartDate: targetDate,
      scopeEndDate: targetDate,
      mealType,
      payload: { note: note[2].trim() },
      householdImpact: true,
      requiresConfirmation: true,
      summary: `Add cook note for ${mealType}: ${note[2].trim()}`,
    });
  }

  const defaultMatch = lower.match(/^default\s+(lunch|dinner)\s+(dish|carb)\s+([0-9]+(?:\.[0-9]+)?)$/);
  if (defaultMatch) {
    return {
      type: "default",
      mealType: defaultMatch[1],
      quantityType: defaultMatch[2],
      value: numberValue(defaultMatch[3]),
    };
  }

  const defaultItem = lower.match(/^default\s+(lunch|dinner)\s+item\s+([a-z0-9_-]+)\s+([0-9]+(?:\.[0-9]+)?)$/);
  if (defaultItem) {
    return {
      type: "default",
      mealType: defaultItem[1],
      quantityType: "item",
      itemKey: defaultItem[2],
      value: numberValue(defaultItem[3]),
    };
  }

  return { type: "unknown" };
}

export function parseCommand(context) {
  const segments = String(context.text || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (segments.length <= 1) return parseOne(context);

  const parsed = segments.map((text) => parseOne({ ...context, text }));
  if (parsed.some((item) => item.type !== "action")) {
    return { type: "error", message: "Multiple commands must all be meal changes" };
  }
  return { type: "action", actions: parsed.flatMap((item) => item.actions) };
}
