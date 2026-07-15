import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const excluded = new Set(["node_modules", ".git", "data", "auth", "audio", "logs"]);
const forbidden = /[0-9]{10,}@(g\.us|lid)|@[a-z0-9._-]+\.whatsapp\.net/i;

function files(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith("._")) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...files(fullPath));
    else result.push(fullPath);
  }
  return result;
}

test("repository contains no private household identifiers", () => {
  for (const file of files(".")) {
    if (file.endsWith("package-lock.json")) continue;
    const buffer = fs.readFileSync(file);
    if (buffer.includes(0)) continue;
    assert.doesNotMatch(buffer.toString("utf8"), forbidden, `${file} contains a private identifier`);
  }
});

test("runtime-secret paths are ignored by Git", () => {
  const ignore = fs.readFileSync(".gitignore", "utf8");
  for (const value of [".env", "config/household.json", "auth/", "data/", "logs/", "audio/"]) {
    assert.match(ignore, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
