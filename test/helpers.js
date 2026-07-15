import fs from "node:fs";
import { openDatabase } from "../src/db/database.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { seedHouseholdConfig } from "../src/db/seed.js";

export function exampleConfig() {
  const config = JSON.parse(fs.readFileSync("config/household.example.json", "utf8"));
  config.groups.operationsGroupId = "111111@g.us";
  config.groups.cookGroupId = "222222@g.us";
  config.household.timezone = "UTC";
  return config;
}

export function createTestDatabase(config = exampleConfig()) {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  seedHouseholdConfig(database, config);
  return database;
}

export function fakeTransport({ failTextOnce = false, failDelete = false } = {}) {
  const calls = [];
  let textFailed = false;
  return {
    calls,
    async sendText(payload) {
      calls.push({ method: "text", ...payload });
      if (failTextOnce && !textFailed) {
        textFailed = true;
        throw new Error("Temporary text failure");
      }
      return { messageId: `text-${calls.length}` };
    },
    async sendVoice(payload) {
      calls.push({ method: "voice", ...payload });
      return { messageId: `voice-${calls.length}` };
    },
    async deleteMessage(payload) {
      calls.push({ method: "delete", ...payload });
      if (failDelete) throw new Error("Delete failed");
      return { messageId: payload.messageId };
    },
  };
}
