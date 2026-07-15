import test from "node:test";
import assert from "node:assert/strict";
import { createScheduler } from "../src/services/scheduler.js";
import { createTestDatabase, exampleConfig, fakeTransport } from "./helpers.js";

test("scheduler catches up in order and never repeats completed jobs", async () => {
  const database = createTestDatabase();
  const transport = fakeTransport();
  const config = exampleConfig();
  const scheduler = createScheduler({ database, transport, config, logger: { log() {}, error() {} } });
  try {
    await scheduler.tick(new Date("2026-07-19T21:59:00Z"));
    assert.equal(transport.calls.length, 0);
    await scheduler.tick(new Date("2026-07-19T22:46:00Z"));
    assert.equal(transport.calls.filter((call) => call.method === "text").length, 3);
    await scheduler.tick(new Date("2026-07-19T22:50:00Z"));
    assert.equal(transport.calls.filter((call) => call.method === "text").length, 3);
  } finally {
    scheduler.stop();
    database.close();
  }
});
