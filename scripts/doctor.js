import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../src/loadEnv.js";
import { loadHouseholdConfig } from "../src/config.js";

let failures = 0;
function check(ok, message) {
  console.log(`${ok ? "✅" : "❌"} ${message}`);
  if (!ok) failures += 1;
}

try {
  const env = loadEnv();
  const configPath = path.resolve(env.CONFIG_PATH || "config/household.json");
  const config = loadHouseholdConfig(configPath);
  check(true, `Configuration valid: ${configPath}`);
  check(fs.existsSync(path.resolve(env.AUTH_DIR || "auth", "creds.json")), "WhatsApp authentication exists");
  check(config.groups.operationsGroupId.endsWith("@g.us"), "Operations group configured");
  check(config.groups.cookGroupId.endsWith("@g.us"), "Cook group configured");
  if (config.voice.enabled) {
    check(process.platform === "darwin", "Voice provider is running on macOS");
    check(spawnSync("say", ["-v", "?"]).status === 0, "macOS say command is available");
    check(spawnSync("ffmpeg", ["-version"]).status === 0, "ffmpeg is available");
  } else {
    check(true, "Voice notes disabled");
  }
} catch (error) {
  check(false, error.message);
}

process.exitCode = failures ? 1 : 0;
