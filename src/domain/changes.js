import { randomUUID } from "node:crypto";

const ACTION_TYPES = new Set([
  "participation",
  "quantity_override",
  "vacation",
  "guest_count",
  "menu_override",
  "cook_note",
]);
const MEAL_TYPES = new Set(["lunch", "dinner", "both"]);

function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

let transactionSequence = 0;

function withTransaction(database, operation) {
  transactionSequence += 1;
  const savepoint = `change_${transactionSequence}`;
  database.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = operation();
    database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    try {
      database.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      database.exec(`RELEASE SAVEPOINT ${savepoint}`);
    } catch {}
    throw error;
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    actorMemberId: row.actor_member_id,
    targetMemberId: row.target_member_id,
    actionType: row.action_type,
    actionKey: row.action_key,
    scopeStartDate: row.scope_start_date,
    scopeEndDate: row.scope_end_date,
    mealType: row.meal_type,
    payload: JSON.parse(row.payload_json),
    status: row.status,
    householdImpact: Boolean(row.household_impact),
    requiresConfirmation: Boolean(row.requires_confirmation),
    confirmedByMemberId: row.confirmed_by_member_id,
    confirmedAt: row.confirmed_at,
    supersedesChangeId: row.supersedes_change_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertMember(database, memberId, { allowNull = false } = {}) {
  if (allowNull && (memberId === null || memberId === undefined)) return;
  const row = database.prepare(
    "SELECT id FROM household_members WHERE id = ? AND is_active = 1"
  ).get(memberId);
  if (!row) throw new Error(`Unknown active member: ${memberId}`);
}

function makeReference() {
  return randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
}

export function getChange(database, id) {
  return mapRow(database.prepare("SELECT * FROM plan_changes WHERE id = ?").get(id));
}

export function findChangeByReference(database, reference) {
  const normalized = String(reference || "").trim().toUpperCase();
  if (!normalized) return null;
  const rows = database.prepare(`
    SELECT * FROM plan_changes
    WHERE reference LIKE ?
    ORDER BY created_at DESC
    LIMIT 2
  `).all(`${normalized}%`);
  if (rows.length > 1) throw new Error("Change reference is ambiguous; use more characters");
  return mapRow(rows[0]);
}

function replaceActive(database, actionKey, timestamp) {
  const current = database.prepare(`
    SELECT id FROM plan_changes WHERE action_key = ? AND status = 'active'
  `).get(actionKey);
  if (!current) return null;
  database.prepare(`
    UPDATE plan_changes SET status = 'replaced', updated_at = ? WHERE id = ?
  `).run(timestamp, current.id);
  return current.id;
}

export function createChange(database, input) {
  assertMember(database, input.actorMemberId);
  assertMember(database, input.targetMemberId, { allowNull: true });
  if (!ACTION_TYPES.has(input.actionType)) throw new Error(`Unsupported action: ${input.actionType}`);
  if (!input.actionKey) throw new Error("actionKey is required");
  if (!isDate(input.scopeStartDate) || !isDate(input.scopeEndDate)) {
    throw new Error("Scope dates must use YYYY-MM-DD");
  }
  if (input.scopeEndDate < input.scopeStartDate) throw new Error("End date cannot precede start date");
  if (input.mealType != null && !MEAL_TYPES.has(input.mealType)) throw new Error("Invalid meal type");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) {
    throw new Error("payload must be an object");
  }
  if (input.householdImpact && !input.requiresConfirmation) {
    throw new Error("Household-impacting changes require confirmation");
  }

  const id = randomUUID();
  const reference = makeReference();
  const timestamp = input.timestamp || new Date().toISOString();
  const status = input.requiresConfirmation ? "pending" : "active";

  return withTransaction(database, () => {
    const supersedes = status === "active" ? replaceActive(database, input.actionKey, timestamp) : null;
    database.prepare(`
      INSERT INTO plan_changes (
        id, reference, actor_member_id, target_member_id, action_type, action_key,
        scope_start_date, scope_end_date, meal_type, payload_json, status,
        household_impact, requires_confirmation, supersedes_change_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      reference,
      input.actorMemberId,
      input.targetMemberId ?? null,
      input.actionType,
      input.actionKey,
      input.scopeStartDate,
      input.scopeEndDate,
      input.mealType ?? null,
      JSON.stringify(input.payload),
      status,
      input.householdImpact ? 1 : 0,
      input.requiresConfirmation ? 1 : 0,
      supersedes,
      timestamp,
      timestamp
    );
    return getChange(database, id);
  });
}

export function confirmChange(database, reference, memberId, timestamp = new Date().toISOString()) {
  assertMember(database, memberId);
  return withTransaction(database, () => {
    const change = findChangeByReference(database, reference);
    if (!change) throw new Error("Change not found");
    if (change.status !== "pending") throw new Error("Only pending changes can be confirmed");
    const supersedes = replaceActive(database, change.actionKey, timestamp);
    database.prepare(`
      UPDATE plan_changes SET status = 'active', confirmed_by_member_id = ?, confirmed_at = ?,
        supersedes_change_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'
    `).run(memberId, timestamp, supersedes, timestamp, change.id);
    return getChange(database, change.id);
  });
}

export function cancelChange(database, reference, timestamp = new Date().toISOString()) {
  const change = findChangeByReference(database, reference);
  if (!change) throw new Error("Change not found");
  if (change.status !== "pending") throw new Error("Only pending changes can be cancelled");
  database.prepare(`UPDATE plan_changes SET status = 'cancelled', updated_at = ? WHERE id = ?`)
    .run(timestamp, change.id);
  return getChange(database, change.id);
}

export function undoChange(database, reference, timestamp = new Date().toISOString()) {
  return withTransaction(database, () => {
    const change = findChangeByReference(database, reference);
    if (!change) throw new Error("Change not found");
    if (change.status !== "active") throw new Error("Only an active change can be undone");
    database.prepare(`UPDATE plan_changes SET status = 'reverted', updated_at = ? WHERE id = ?`)
      .run(timestamp, change.id);
    let restored = null;
    if (change.supersedesChangeId) {
      const previous = getChange(database, change.supersedesChangeId);
      if (previous?.status === "replaced") {
        database.prepare(`UPDATE plan_changes SET status = 'active', updated_at = ? WHERE id = ?`)
          .run(timestamp, previous.id);
        restored = getChange(database, previous.id);
      }
    }
    return { undone: getChange(database, change.id), restored };
  });
}

export function listEffectiveChanges(database, serviceDate) {
  if (!isDate(serviceDate)) throw new Error("serviceDate must use YYYY-MM-DD");
  return database.prepare(`
    SELECT * FROM plan_changes
    WHERE status = 'active'
      AND scope_start_date <= ?
      AND scope_end_date >= ?
    ORDER BY created_at, id
  `).all(serviceDate, serviceDate).map(mapRow);
}

export function listRecentChanges(database, memberId, limit = 8) {
  return database.prepare(`
    SELECT * FROM plan_changes
    WHERE actor_member_id = ? OR target_member_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(memberId, memberId, limit).map(mapRow);
}
