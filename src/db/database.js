import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(databasePath = "data/flat-meal-bot.db") {
  const resolved = databasePath === ":memory:" ? databasePath : path.resolve(databasePath);

  if (resolved !== ":memory:") {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }

  const database = new DatabaseSync(resolved);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);

  return database;
}
