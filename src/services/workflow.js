import fs from "node:fs";
import { materializeDayPlan } from "../domain/materializer.js";
import { renderCookText, renderOperationsSummary } from "../domain/renderer.js";
import { ensureSnapshot, getLockedSnapshot, lockSnapshot, setSnapshotVoice } from "./snapshots.js";
import { deleteCookDeliveries, sendDelivery } from "./deliveries.js";
import { generateVoiceNote } from "./voice.js";

export function buildCurrentSnapshot(database, serviceDate) {
  const materialized = materializeDayPlan(database, serviceDate);
  const snapshot = ensureSnapshot(database, {
    serviceDate,
    materialized,
    operationsText: renderOperationsSummary(materialized),
    cookText: renderCookText(materialized),
  });
  return { snapshot, materialized };
}

async function ensureVoice(database, snapshot, { voiceConfig, audioDirectory, voiceGenerator = generateVoiceNote }) {
  if (!voiceConfig?.enabled) return snapshot;
  if (snapshot.voiceFilePath && fs.existsSync(snapshot.voiceFilePath)) return snapshot;
  const filePath = await voiceGenerator({
    text: snapshot.cookText,
    snapshotId: snapshot.id,
    voiceConfig,
    outputDirectory: audioDirectory,
  });
  return filePath ? setSnapshotVoice(database, snapshot.id, filePath) : snapshot;
}

export async function sendMenuAnnouncement(database, context) {
  const { snapshot } = buildCurrentSnapshot(database, context.serviceDate);
  return sendDelivery(database, {
    snapshotId: snapshot.id,
    deliveryType: "operations_announcement",
    destinationGroupId: context.operationsGroupId,
    transport: context.transport,
  });
}

export async function sendReviewSummary(database, context) {
  const { snapshot } = buildCurrentSnapshot(database, context.serviceDate);
  return sendDelivery(database, {
    snapshotId: snapshot.id,
    deliveryType: "operations_review",
    destinationGroupId: context.operationsGroupId,
    transport: context.transport,
  });
}

export function lockCurrentPlan(database, serviceDate) {
  const { snapshot } = buildCurrentSnapshot(database, serviceDate);
  return snapshot.status === "locked" ? snapshot : lockSnapshot(database, snapshot.id);
}

export async function deliverCookPlan(database, {
  serviceDate,
  cookGroupId,
  transport,
  voiceConfig,
  audioDirectory,
  voiceGenerator,
}) {
  let snapshot = getLockedSnapshot(database, serviceDate);
  if (!snapshot) throw new Error(`No locked snapshot for ${serviceDate}`);

  const text = await sendDelivery(database, {
    snapshotId: snapshot.id,
    deliveryType: "cook_text",
    destinationGroupId: cookGroupId,
    transport,
  });

  let voice = null;
  if (voiceConfig?.enabled) {
    snapshot = await ensureVoice(database, snapshot, { voiceConfig, audioDirectory, voiceGenerator });
    voice = await sendDelivery(database, {
      snapshotId: snapshot.id,
      deliveryType: "cook_voice",
      destinationGroupId: cookGroupId,
      transport,
    });
  }

  return { text, voice };
}

export async function handleLatePlanChange(database, {
  serviceDate,
  operationsGroupId,
  cookGroupId,
  transport,
  voiceConfig,
  audioDirectory,
  voiceGenerator,
}) {
  const previous = getLockedSnapshot(database, serviceDate);
  if (!previous) return { updated: false, reason: "not_locked" };

  const { snapshot: candidate, materialized } = buildCurrentSnapshot(database, serviceDate);
  if (candidate.id === previous.id || candidate.snapshotHash === previous.snapshotHash) {
    return { updated: false, reason: "unchanged" };
  }

  let replacement = candidate;
  if (voiceConfig?.enabled) {
    // Generate before deleting old cook instructions.
    replacement = await ensureVoice(database, replacement, { voiceConfig, audioDirectory, voiceGenerator });
  }
  replacement = lockSnapshot(database, replacement.id);

  const operations = await sendDelivery(database, {
    snapshotId: replacement.id,
    deliveryType: "operations_update",
    destinationGroupId: operationsGroupId,
    transport,
    textOverride: renderOperationsSummary(materialized, { isUpdate: true }),
  });

  const deletions = await deleteCookDeliveries(database, {
    snapshotId: previous.id,
    transport,
  });

  const text = await sendDelivery(database, {
    snapshotId: replacement.id,
    deliveryType: "cook_text",
    destinationGroupId: cookGroupId,
    transport,
  });

  let voice = null;
  if (voiceConfig?.enabled) {
    voice = await sendDelivery(database, {
      snapshotId: replacement.id,
      deliveryType: "cook_voice",
      destinationGroupId: cookGroupId,
      transport,
    });
  }

  return {
    updated: true,
    previousSnapshotId: previous.id,
    replacementSnapshotId: replacement.id,
    operations,
    deletions,
    text,
    voice,
  };
}
