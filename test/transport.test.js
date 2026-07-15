import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeLogValue } from "../src/transport/baileys.js";

test("transport log sanitizer does not serialize arbitrary objects", () => {
  assert.equal(sanitizeLogValue({ secret: "value" }), "[redacted object]");
  assert.equal(sanitizeLogValue({ message: "Disconnected", statusCode: 408 }), "Disconnected (status 408)");
});
