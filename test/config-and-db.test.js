import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateHouseholdConfig } from "../src/config.js";
import { loadHousehold, seedHouseholdConfig } from "../src/db/seed.js";
import { createTestDatabase, exampleConfig } from "./helpers.js";

test("example config validates when group IDs are incomplete", () => {
  const config = JSON.parse(fs.readFileSync("config/household.example.json", "utf8"));
  assert.doesNotThrow(() => validateHouseholdConfig(config, { allowIncompleteGroups: true }));
});

test("database is seeded entirely from configuration", () => {
  const database = createTestDatabase();
  try {
    const household = loadHousehold(database);
    assert.equal(household.members.length, 2);
    assert.equal(household.weeklyMenu.length, 7);
    assert.equal(household.members[1].defaults.lunch.customItems[0].key, "personal-protein");
  } finally {
    database.close();
  }
});

test("seeding is idempotent by default", () => {
  const config = exampleConfig();
  const database = createTestDatabase(config);
  try {
    const result = seedHouseholdConfig(database, config);
    assert.deepEqual(result, { seeded: false, reason: "already_initialized", memberCount: 2 });
  } finally {
    database.close();
  }
});
