import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

let _sqlite: Database | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb(path?: string): ReturnType<typeof drizzle> {
  if (!_db) {
    const dbPath = path ?? process.env["DATABASE_PATH"] ?? "./data/notes.db";
    _sqlite = new Database(dbPath, { create: true });
    _sqlite.exec("PRAGMA journal_mode = WAL;");
    _sqlite.exec("PRAGMA foreign_keys = ON;");
    _db = drizzle(_sqlite, { schema });
  }
  return _db;
}

export function closeDb(): void {
  _sqlite?.close();
  _sqlite = null;
  _db = null;
}
