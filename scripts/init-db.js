import path from "node:path";
import { loadEnv } from "../src/loadEnv.js";
import { loadHouseholdConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { seedHouseholdConfig } from "../src/db/seed.js";

const env = loadEnv();
const config = loadHouseholdConfig(path.resolve(env.CONFIG_PATH || "config/household.json"));
const databasePath = path.resolve(env.DB_PATH || "data/flat-meal-bot.db");
const database = openDatabase(databasePath);
try {
  migrateDatabase(database);
  const result = seedHouseholdConfig(database, config);
  console.log(result.seeded ? "Household database initialized." : "Household database already initialized.");
  console.log(`Database: ${databasePath}`);
  console.log(`Members: ${result.memberCount}`);
} finally {
  database.close();
}
