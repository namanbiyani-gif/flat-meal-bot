import path from "node:path";
import { loadEnv } from "./loadEnv.js";
import { loadHouseholdConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { migrateDatabase } from "./db/migrate.js";
import { seedHouseholdConfig } from "./db/seed.js";
import { createInboundService } from "./services/inbound.js";
import { createScheduler } from "./services/scheduler.js";
import { handleLatePlanChange } from "./services/workflow.js";
import { createBaileysTransport } from "./transport/baileys.js";

const env = loadEnv();
const config = loadHouseholdConfig(path.resolve(env.CONFIG_PATH || "config/household.json"));
const database = openDatabase(path.resolve(env.DB_PATH || "data/flat-meal-bot.db"));
const audioDirectory = path.resolve(env.AUDIO_DIR || "audio/generated");

migrateDatabase(database);
seedHouseholdConfig(database, config);

let inbound = null;
const transport = createBaileysTransport({
  authDirectory: path.resolve(env.AUTH_DIR || "auth"),
  operationsGroupId: config.groups.operationsGroupId,
  onInboundMessage: async (envelope) => inbound?.(envelope),
});

inbound = createInboundService({
  database,
  transport,
  config,
  onPlanChanged: async (serviceDate) => {
    await handleLatePlanChange(database, {
      serviceDate,
      operationsGroupId: config.groups.operationsGroupId,
      cookGroupId: config.groups.cookGroupId,
      transport,
      voiceConfig: config.voice,
      audioDirectory,
    });
  },
});

const scheduler = createScheduler({
  database,
  transport,
  config,
  audioDirectory,
});

await transport.start();
await transport.waitUntilConnected();
scheduler.start();

console.log("Flat Meal Bot started.");
console.log(`Household: ${config.household.name}`);
console.log(`Timezone: ${config.household.timezone}`);
console.log("Send 'change' in the operations group to open the guided menu.");

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Stopping Flat Meal Bot.");
  scheduler.stop();
  transport.stop();
  database.close();
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
