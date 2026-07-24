/**
 * FTS5 setup for notes and tasks.
 *
 * Run this AFTER `drizzle-kit migrate` to create FTS5 virtual tables
 * and content-sync triggers.
 *
 * Usage:
 *   bun run db/fts5.ts
 *   # or imported and called programmatically:
 *   import { setupFts5 } from "./fts5";
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Virtual tables
// ---------------------------------------------------------------------------

const CREATE_NOTES_FTS = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    content
  );
`;

const CREATE_TASKS_FTS = sql`
  CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
    title, description
  );
`;

// ---------------------------------------------------------------------------
// Sync triggers — notes → notes_fts
// ---------------------------------------------------------------------------

const TRIGGER_NOTES_INSERT = sql`
  CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
`;

// bun:sqlite chokes on FTS5's VALUES('delete', …) INSERT — use equivalent DELETE instead.

const TRIGGER_NOTES_DELETE = sql`
  CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
    DELETE FROM notes_fts WHERE rowid = old.rowid;
  END;
`;

const TRIGGER_NOTES_UPDATE = sql`
  CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
    REPLACE INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
`;

// ---------------------------------------------------------------------------
// Sync triggers — kanban_tasks → tasks_fts
// ---------------------------------------------------------------------------

const TRIGGER_TASKS_INSERT = sql`
  CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON kanban_tasks BEGIN
    INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
  END;
`;

const TRIGGER_TASKS_DELETE = sql`
  CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON kanban_tasks BEGIN
    DELETE FROM tasks_fts WHERE rowid = old.rowid;
  END;
`;

const TRIGGER_TASKS_UPDATE = sql`
  CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON kanban_tasks BEGIN
    REPLACE INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
  END;
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const statements = [
  CREATE_NOTES_FTS,
  CREATE_TASKS_FTS,
  TRIGGER_NOTES_INSERT,
  TRIGGER_NOTES_DELETE,
  TRIGGER_NOTES_UPDATE,
  TRIGGER_TASKS_INSERT,
  TRIGGER_TASKS_DELETE,
  TRIGGER_TASKS_UPDATE,
];

export function setupFts5(): void {
  for (const stmt of statements) {
    db.run(stmt);
  }
}

// Run directly when called as a script: `bun run db/fts5.ts`
if (import.meta.main) {
  setupFts5();
  console.log("FTS5 setup complete.");
}
