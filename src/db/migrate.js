import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIRECTORY = fileURLToPath(new URL("./migrations", import.meta.url));

export function migrateDatabase(database, migrationsDirectory = DEFAULT_DIRECTORY) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  const applied = new Set(
    database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version)
  );

  const files = fs.readdirSync(migrationsDirectory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  const record = database.prepare("INSERT INTO schema_migrations (version) VALUES (?)");

  for (const file of files) {
    if (applied.has(file)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(fs.readFileSync(path.join(migrationsDirectory, file), "utf8"));
      record.run(file);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
    }
  }
}
