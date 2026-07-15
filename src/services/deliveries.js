import { randomUUID } from "node:crypto";
import { getSnapshot } from "./snapshots.js";

function mapDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    deliveryType: row.delivery_type,
    destinationGroupId: row.destination_group_id,
    status: row.status,
    attemptCount: row.attempt_count,
    messageId: row.message_id,
    lastError: row.last_error,
    sentAt: row.sent_at,
    deletionStatus: row.deletion_status,
    deletionAttemptCount: row.deletion_attempt_count,
    deletionError: row.deletion_error,
    deletedAt: row.deleted_at,
  };
}

export function getDelivery(database, snapshotId, deliveryType) {
  return mapDelivery(database.prepare(`
    SELECT * FROM deliveries WHERE snapshot_id = ? AND delivery_type = ?
  `).get(snapshotId, deliveryType));
}

function deliveryText(snapshot, deliveryType) {
  if (deliveryType.startsWith("operations_")) return snapshot.operationsText;
  if (deliveryType === "cook_text") return snapshot.cookText;
  return null;
}

export async function sendDelivery(database, {
  snapshotId,
  deliveryType,
  destinationGroupId,
  transport,
  textOverride = null,
  timestamp = new Date().toISOString(),
}) {
  const snapshot = getSnapshot(database, snapshotId);
  if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);
  if ((deliveryType === "cook_text" || deliveryType === "cook_voice") && snapshot.status !== "locked") {
    throw new Error("Cook deliveries require a locked snapshot");
  }

  let delivery = getDelivery(database, snapshotId, deliveryType);
  if (delivery?.status === "sent") return delivery;

  if (!delivery) {
    const id = randomUUID();
    database.prepare(`
      INSERT INTO deliveries (id, snapshot_id, delivery_type, destination_group_id)
      VALUES (?, ?, ?, ?)
    `).run(id, snapshotId, deliveryType, destinationGroupId);
    delivery = getDelivery(database, snapshotId, deliveryType);
  }

  database.prepare(`
    UPDATE deliveries SET status = 'sending', attempt_count = attempt_count + 1,
      last_error = NULL, updated_at = ? WHERE id = ?
  `).run(timestamp, delivery.id);

  try {
    let response;
    if (deliveryType === "cook_voice") {
      if (!snapshot.voiceFilePath) throw new Error("Snapshot voice file is missing");
      response = await transport.sendVoice({
        groupId: destinationGroupId,
        filePath: snapshot.voiceFilePath,
        purpose: deliveryType,
      });
    } else {
      response = await transport.sendText({
        groupId: destinationGroupId,
        text: textOverride ?? deliveryText(snapshot, deliveryType),
        purpose: deliveryType,
      });
    }

    database.prepare(`
      UPDATE deliveries SET status = 'sent', message_id = ?, sent_at = ?, updated_at = ?
      WHERE id = ?
    `).run(response?.messageId || "", timestamp, timestamp, delivery.id);
  } catch (error) {
    database.prepare(`
      UPDATE deliveries SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?
    `).run(error.message, timestamp, delivery.id);
    throw error;
  }

  return getDelivery(database, snapshotId, deliveryType);
}

export function listCookDeliveries(database, snapshotId) {
  return database.prepare(`
    SELECT * FROM deliveries
    WHERE snapshot_id = ? AND delivery_type IN ('cook_text', 'cook_voice')
    ORDER BY delivery_type
  `).all(snapshotId).map(mapDelivery);
}

export async function deleteCookDeliveries(database, { snapshotId, transport, now = () => new Date().toISOString() }) {
  const results = [];
  for (const delivery of listCookDeliveries(database, snapshotId)) {
    if (delivery.status !== "sent" || !delivery.messageId) continue;
    if (delivery.deletionStatus === "deleted") {
      results.push({ deliveryType: delivery.deliveryType, status: "skipped", reason: "already deleted" });
      continue;
    }

    database.prepare(`
      UPDATE deliveries SET deletion_status = 'deleting',
        deletion_attempt_count = deletion_attempt_count + 1,
        deletion_error = NULL, updated_at = ? WHERE id = ?
    `).run(now(), delivery.id);

    try {
      await transport.deleteMessage({
        groupId: delivery.destinationGroupId,
        messageId: delivery.messageId,
        purpose: `delete_${delivery.deliveryType}`,
      });
      database.prepare(`
        UPDATE deliveries SET deletion_status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?
      `).run(now(), now(), delivery.id);
      results.push({ deliveryType: delivery.deliveryType, status: "deleted" });
    } catch (error) {
      database.prepare(`
        UPDATE deliveries SET deletion_status = 'failed', deletion_error = ?, updated_at = ? WHERE id = ?
      `).run(error.message, now(), delivery.id);
      results.push({ deliveryType: delivery.deliveryType, status: "failed", error: error.message });
    }
  }
  return results;
}
