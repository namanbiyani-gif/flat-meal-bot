import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateVoiceNote } from "../src/services/voice.js";

test("disabled voice returns null without invoking commands", async () => {
  let calls = 0;
  const result = await generateVoiceNote({
    text: "hello",
    snapshotId: "one",
    voiceConfig: { enabled: false },
    run: async () => { calls += 1; },
  });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test("macOS voice generates OGG and removes intermediate audio", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meal-voice-"));
  const calls = [];
  try {
    const result = await generateVoiceNote({
      text: "hello",
      snapshotId: "snapshot",
      voiceConfig: { enabled: true, provider: "macos-say", voice: "Test", speakingRate: 110 },
      outputDirectory: directory,
      platform: "darwin",
      run: async (command, args) => {
        calls.push({ command, args });
        const output = command === "say" ? args[args.indexOf("-o") + 1] : args.at(-1);
        fs.writeFileSync(output, "audio");
      },
    });
    assert.equal(path.extname(result), ".ogg");
    assert.equal(calls.map((call) => call.command).join(","), "say,ffmpeg");
    assert.equal(fs.existsSync(path.join(directory, "snapshot.aiff")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
