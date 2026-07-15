import { calculateDayPlan } from "./calculator.js";
import { listEffectiveChanges } from "./changes.js";
import { loadHousehold } from "../db/seed.js";

const MEALS = ["lunch", "dinner"];

function assertDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("serviceDate must use YYYY-MM-DD");
  }
}

export function weekdayForDate(serviceDate) {
  assertDate(serviceDate);
  const day = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function menuForDate(weeklyMenu, serviceDate) {
  const weekday = weekdayForDate(serviceDate);
  const day = weeklyMenu.find((entry) => entry.weekday === weekday);
  if (!day) throw new Error(`No weekly menu for weekday ${weekday}`);
  return Object.fromEntries(MEALS.map((mealType) => {
    const meal = day[mealType];
    if (!meal) throw new Error(`Missing ${mealType} menu for weekday ${weekday}`);
    return [mealType, {
      dishName: meal.dishName,
      carbType: meal.carbType,
      notes: meal.notes || "",
    }];
  }));
}

function selectedMeals(mealType) {
  if (mealType === "both") return [...MEALS];
  if (MEALS.includes(mealType)) return [mealType];
  throw new Error(`Invalid meal type: ${mealType}`);
}

function ensureMember(membersById, memberId) {
  if (!memberId || !membersById.has(memberId)) {
    throw new Error(`Change targets an unknown member: ${memberId}`);
  }
  return memberId;
}

function applyQuantityOverride(destination, payload) {
  if (payload.fullLeftovers === true) {
    destination.sharedDishPortions = 0;
    destination.carbQuantity = 0;
    destination.removeCustomItems = ["*"];
    return;
  }

  if (Object.hasOwn(payload, "sharedDishPortions")) {
    destination.sharedDishPortions = payload.sharedDishPortions;
  }
  if (Object.hasOwn(payload, "carbQuantity")) {
    destination.carbQuantity = payload.carbQuantity;
  }
  if (payload.customItems) {
    destination.customItems = {
      ...(destination.customItems || {}),
      ...payload.customItems,
    };
  }
  if (Array.isArray(payload.removeCustomItems)) {
    destination.removeCustomItems = [
      ...(destination.removeCustomItems || []),
      ...payload.removeCustomItems,
    ];
  }
}

function buildGuests(guestCounts, membersById, serviceDate) {
  const guests = [];
  for (const [key, value] of guestCounts.entries()) {
    const [ownerMemberId, mealType] = key.split("|");
    const owner = membersById.get(ownerMemberId);
    if (!owner) throw new Error(`Guest owner is not active: ${ownerMemberId}`);
    for (let index = 1; index <= value.count; index += 1) {
      guests.push({
        id: `guest:${ownerMemberId}:${serviceDate}:${mealType}:${index}`,
        displayName: `${owner.displayName} guest ${index}`,
        copyFromMemberId: value.copyFromMemberId || ownerMemberId,
        meals: {
          lunch: mealType === "lunch",
          dinner: mealType === "dinner",
        },
      });
    }
  }
  return guests;
}

export function materializeDayPlan(database, serviceDate) {
  assertDate(serviceDate);
  const household = loadHousehold(database);
  if (!household.members.length) throw new Error("Household database is not initialized");

  const membersById = new Map(household.members.map((member) => [member.id, member]));
  const menu = menuForDate(household.weeklyMenu, serviceDate);
  const participation = {};
  const overrides = {};
  const guestCounts = new Map();
  const cookNotes = [];
  const activeChanges = listEffectiveChanges(database, serviceDate);

  for (const change of activeChanges) {
    const meals = change.mealType ? selectedMeals(change.mealType) : [];

    if (change.actionType === "participation" || change.actionType === "vacation") {
      const memberId = ensureMember(membersById, change.targetMemberId);
      participation[memberId] ||= {};
      for (const mealType of meals) {
        participation[memberId][mealType] = change.payload.participating !== false;
      }
      continue;
    }

    if (change.actionType === "quantity_override") {
      const memberId = ensureMember(membersById, change.targetMemberId);
      overrides[memberId] ||= {};
      for (const mealType of meals) {
        overrides[memberId][mealType] ||= {};
        applyQuantityOverride(overrides[memberId][mealType], change.payload);
      }
      continue;
    }

    if (change.actionType === "guest_count") {
      const ownerMemberId = ensureMember(membersById, change.payload.ownerMemberId);
      const count = Number(change.payload.count);
      if (!Number.isInteger(count) || count < 0) throw new Error("Guest count must be a non-negative integer");
      for (const mealType of meals) {
        guestCounts.set(`${ownerMemberId}|${mealType}`, {
          count,
          copyFromMemberId: change.payload.copyFromMemberId || household.guestDefaults.copyFromMemberId,
        });
      }
      continue;
    }

    if (change.actionType === "menu_override") {
      for (const mealType of meals) {
        if (change.payload.dishName) menu[mealType].dishName = String(change.payload.dishName).trim();
        if (change.payload.carbType) menu[mealType].carbType = change.payload.carbType;
        if (Object.hasOwn(change.payload, "notes")) menu[mealType].notes = String(change.payload.notes || "");
      }
      continue;
    }

    if (change.actionType === "cook_note") {
      const note = String(change.payload.note || "").trim();
      if (note) cookNotes.push({ mealType: change.mealType || "both", note });
      continue;
    }

    throw new Error(`Unsupported active change type: ${change.actionType}`);
  }

  // A wildcard means all configured custom items should be removed for that meal.
  for (const [memberId, mealOverrides] of Object.entries(overrides)) {
    const member = membersById.get(memberId);
    for (const mealType of MEALS) {
      const override = mealOverrides[mealType];
      if (override?.removeCustomItems?.includes("*")) {
        override.removeCustomItems = member.defaults[mealType].customItems.map((item) => item.key);
      }
    }
  }

  const plan = calculateDayPlan({
    serviceDate,
    menu,
    members: household.members,
    guestDefaults: household.guestDefaults,
    memberParticipation: participation,
    memberOverrides: overrides,
    guests: buildGuests(guestCounts, membersById, serviceDate),
  });

  return {
    serviceDate,
    household: household.household,
    groups: household.groups,
    schedule: household.schedule,
    voice: household.voice,
    members: household.members,
    plan,
    cookNotes,
    appliedChangeIds: activeChanges.map((change) => change.id),
  };
}
