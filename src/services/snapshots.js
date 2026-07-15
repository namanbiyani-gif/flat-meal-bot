import { createHash, randomUUID } from "node:crypto";

function parse(value) {
  return JSON.parse(value);
}

function mapSnapshot(row) {
  if (!row) return null;
  return {
    id: row.id,
    serviceDate: row.service_date,
    version: row.version,
    status: row.status,
    snapshotHash: row.snapshot_hash,
    materialized: parse(row.materialized_json),
    operationsText: row.operations_text,
    cookText: row.cook_text,
    voiceFilePath: row.voice_file_path,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
  };
}

function hashSnapshot({ materialized, operationsText, cookText }) {
  return createHash("sha256")
    .update(JSON.stringify({ materialized, operationsText, cookText }))
    .digest("hex");
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

export function getSnapshot(database, snapshotId) {
  return mapSnapshot(database.prepare("SELECT * FROM daily_snapshots WHERE id = ?").get(snapshotId));
}

export function getLatestSnapshot(database, serviceDate) {
  return mapSnapshot(database.prepare(`
    SELECT * FROM daily_snapshots WHERE service_date = ? ORDER BY version DESC LIMIT 1
  `).get(serviceDate));
}

export function getLockedSnapshot(database, serviceDate) {
  return mapSnapshot(database.prepare(`
    SELECT * FROM daily_snapshots WHERE service_date = ? AND status = 'locked'
  `).get(serviceDate));
}

export function ensureSnapshot(database, { serviceDate, materialized, operationsText, cookText }) {
  const hash = hashSnapshot({ materialized, operationsText, cookText });
  const latest = getLatestSnapshot(database, serviceDate);
  if (latest?.snapshotHash === hash) return latest;

  const id = randomUUID();
  const version = (latest?.version || 0) + 1;
  database.prepare(`
    INSERT INTO daily_snapshots
      (id, service_date, version, status, snapshot_hash, materialized_json, operations_text, cook_text)
    VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run(id, serviceDate, version, hash, JSON.stringify(materialized), operationsText, cookText);
  return getSnapshot(database, id);
}

export function lockSnapshot(database, snapshotId, timestamp = new Date().toISOString()) {
  return withTransaction(database, () => {
    const snapshot = getSnapshot(database, snapshotId);
    if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);
    if (snapshot.status === "locked") return snapshot;
    if (snapshot.status !== "draft") throw new Error("Only a draft snapshot can be locked");

    database.prepare(`
      UPDATE daily_snapshots SET status = 'superseded'
      WHERE service_date = ? AND status = 'locked'
    `).run(snapshot.serviceDate);
    database.prepare(`
      UPDATE daily_snapshots SET status = 'locked', locked_at = ?
      WHERE id = ? AND status = 'draft'
    `).run(timestamp, snapshotId);
    return getSnapshot(database, snapshotId);
  });
}

export function setSnapshotVoice(database, snapshotId, voiceFilePath) {
  database.prepare("UPDATE daily_snapshots SET voice_file_path = ? WHERE id = ?")
    .run(voiceFilePath, snapshotId);
  return getSnapshot(database, snapshotId);
}
