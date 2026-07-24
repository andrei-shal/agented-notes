import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../schema";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/** Migrations dir relative to CWD (expected: `app/`). */
const DRIZZLE_DIR = join(import.meta.dir, "../../drizzle");

/** FTS5 setup SQL – must stay in sync with app/db/fts5.ts */
const FTS5_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description);

CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
  REPLACE INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON kanban_tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON kanban_tasks BEGIN
  DELETE FROM tasks_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON kanban_tasks BEGIN
  REPLACE INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
`;

export interface TestDb {
  sqlite: Database;
  db: BunSQLiteDatabase<typeof schema>;
}

/** Create an in-memory test database with all tables + FTS5 applied. */
export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  // Apply DDL from the generated migration file
  const migrationDir = DRIZZLE_DIR;
  const files = Array.from(
    new Bun.Glob("*.sql").scanSync({ cwd: migrationDir }),
  ).sort();
  for (const file of files) {
    const content = readFileSync(join(migrationDir, file), "utf-8");
    // drizzle-kit separates statements with "--> statement-breakpoint"
    for (const stmt of content.split("--> statement-breakpoint\n")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  // Apply FTS5
  for (const stmt of FTS5_SQL.trim().split("\n\n")) {
    const trimmed = stmt.trim();
    if (trimmed) sqlite.exec(trimmed);
  }

  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
