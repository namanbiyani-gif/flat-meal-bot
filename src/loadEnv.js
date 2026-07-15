import fs from "node:fs";
import path from "node:path";

export function loadEnv(
  filePath = path.resolve(".env")
) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Environment file not found: ${filePath}`
    );
  }

  const values = {};

  for (
    const line of
    fs.readFileSync(filePath, "utf8").split("\n")
  ) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("#")
    ) {
      continue;
    }

    const separator =
      trimmed.indexOf("=");

    if (separator === -1) continue;

    const key = trimmed
      .slice(0, separator)
      .trim();

    const value = trimmed
      .slice(separator + 1)
      .trim();

    values[key] = value;
  }

  return values;
}
