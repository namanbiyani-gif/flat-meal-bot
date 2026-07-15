import { clockToMinuteOfDay, localDateTimeParts, tomorrowDate } from "./dates.js";
import { deliverCookPlan, lockCurrentPlan, sendMenuAnnouncement, sendReviewSummary } from "./workflow.js";

async function runOnce(database, { serviceDate, actionType, operation, timestamp = new Date().toISOString() }) {
  const existing = database.prepare(`
    SELECT status FROM scheduled_runs WHERE service_date = ? AND action_type = ?
  `).get(serviceDate, actionType);
  if (existing?.status === "completed") return { status: "already_completed" };

  database.prepare(`
    INSERT INTO scheduled_runs
      (service_date, action_type, status, attempt_count, started_at, updated_at)
    VALUES (?, ?, 'running', 1, ?, ?)
    ON CONFLICT(service_date, action_type) DO UPDATE SET
      status = 'running',
      attempt_count = scheduled_runs.attempt_count + 1,
      started_at = excluded.started_at,
      last_error = NULL,
      updated_at = excluded.updated_at
    WHERE scheduled_runs.status != 'completed'
  `).run(serviceDate, actionType, timestamp, timestamp);

  try {
    const result = await operation();
    database.prepare(`
      UPDATE scheduled_runs SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE service_date = ? AND action_type = ?
    `).run(timestamp, timestamp, serviceDate, actionType);
    return { status: "completed", result };
  } catch (error) {
    database.prepare(`
      UPDATE scheduled_runs SET status = 'failed', last_error = ?, updated_at = ?
      WHERE service_date = ? AND action_type = ?
    `).run(error.message, timestamp, serviceDate, actionType);
    throw error;
  }
}

function jobs(config) {
  return [
    ["menu_announcement", config.schedule.menuAnnouncement],
    ["review_summary", config.schedule.reviewSummary],
    ["lock_snapshot", config.schedule.lockPlan],
    ["cook_delivery", config.schedule.cookDelivery],
  ].map(([actionType, time]) => ({
    actionType,
    minuteOfDay: clockToMinuteOfDay(time, actionType),
  })).sort((a, b) => a.minuteOfDay - b.minuteOfDay);
}

export function createScheduler({
  database,
  transport,
  config,
  audioDirectory,
  voiceGenerator,
  intervalMs = 30000,
  logger = console,
}) {
  const schedule = jobs(config);
  let timer = null;
  let running = false;

  async function execute(actionType, serviceDate) {
    const context = {
      serviceDate,
      transport,
      operationsGroupId: config.groups.operationsGroupId,
      cookGroupId: config.groups.cookGroupId,
      voiceConfig: config.voice,
      audioDirectory,
      voiceGenerator,
    };
    if (actionType === "menu_announcement") return sendMenuAnnouncement(database, context);
    if (actionType === "review_summary") return sendReviewSummary(database, context);
    if (actionType === "lock_snapshot") return lockCurrentPlan(database, serviceDate);
    if (actionType === "cook_delivery") return deliverCookPlan(database, context);
    throw new Error(`Unknown scheduled action: ${actionType}`);
  }

  async function tick(now = new Date()) {
    if (running) return;
    running = true;
    try {
      const local = localDateTimeParts({ now, timeZone: config.household.timezone });
      const minuteOfDay = local.hour * 60 + local.minute;
      const serviceDate = tomorrowDate({ now, timeZone: config.household.timezone });
      for (const job of schedule) {
        if (minuteOfDay < job.minuteOfDay) continue;
        try {
          const result = await runOnce(database, {
            serviceDate,
            actionType: job.actionType,
            operation: () => execute(job.actionType, serviceDate),
          });
          if (result.status === "completed") logger.log(`Completed ${job.actionType} for ${serviceDate}`);
        } catch (error) {
          logger.error(`Scheduled ${job.actionType} failed: ${error.message}`);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      tick().catch((error) => logger.error(`Initial scheduler tick failed: ${error.message}`));
      timer = setInterval(() => tick().catch((error) => logger.error(`Scheduler tick failed: ${error.message}`)), intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export { runOnce as runScheduledJob };
