import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../src/db/database.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { seedHouseholdConfig } from "../src/db/seed.js";
import { materializeDayPlan } from "../src/domain/materializer.js";
import { renderCookText, renderOperationsSummary } from "../src/domain/renderer.js";
import { loadHouseholdConfig } from "../src/config.js";

const configPath = fs.existsSync("config/household.json")
  ? "config/household.json"
  : "config/household.example.json";
const config = loadHouseholdConfig(path.resolve(configPath), {
  allowIncompleteGroups: configPath.endsWith(".example.json"),
});
const serviceDate = process.argv[2] || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const database = openDatabase(":memory:");
try {
  migrateDatabase(database);
  seedHouseholdConfig(database, config, { allowIncompleteGroups: configPath.endsWith(".example.json") });
  const materialized = materializeDayPlan(database, serviceDate);
  console.log("=== OPERATIONS ===");
  console.log(renderOperationsSummary(materialized));
  console.log("\n=== COOK ===");
  console.log(renderCookText(materialized));
} finally {
  database.close();
}
