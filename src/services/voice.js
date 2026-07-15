import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);

export async function generateVoiceNote({
  text,
  snapshotId,
  voiceConfig,
  outputDirectory = "audio/generated",
  platform = process.platform,
  run = execFileAsync,
}) {
  if (!voiceConfig?.enabled || voiceConfig.provider === "none") return null;
  if (voiceConfig.provider !== "macos-say") throw new Error(`Unsupported voice provider: ${voiceConfig.provider}`);
  if (platform !== "darwin") throw new Error("The macos-say voice provider requires macOS");
  if (!text?.trim()) throw new Error("Voice text cannot be empty");

  const directory = path.resolve(outputDirectory);
  fs.mkdirSync(directory, { recursive: true });
  const base = path.join(directory, snapshotId);
  const aiffPath = `${base}.aiff`;
  const oggPath = `${base}.ogg`;
  const voice = voiceConfig.voice || "Samantha";
  const rate = String(Math.round(Number(voiceConfig.speakingRate || 175)));

  try {
    await run("say", ["-v", voice, "-r", rate, "-o", aiffPath, text]);
    await run("ffmpeg", [
      "-y",
      "-loglevel", "error",
      "-i", aiffPath,
      "-c:a", "libopus",
      "-b:a", "32k",
      oggPath,
    ]);
    if (!fs.existsSync(oggPath) || fs.statSync(oggPath).size === 0) {
      throw new Error("Voice conversion did not create a usable OGG file");
    }
    return oggPath;
  } finally {
    fs.rmSync(aiffPath, { force: true });
  }
}
