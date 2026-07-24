/**
 * FTS5 setup for notes and tasks.
 *
 * Run this AFTER `drizzle-kit migrate` to create FTS5 virtual tables.
 * Content sync is handled at the application layer (services/), not via
 * SQL triggers, because FTS5 DML inside triggers conflicts with
 * `PRAGMA foreign_keys = ON` in bun:sqlite.
 *
 * Usage:
 *   bun run db/fts5.ts
 *   # or imported and called programmatically:
 *   import { setupFts5, syncNoteFts, syncTaskFts } from "./fts5";
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { notes, kanbanTasks } from "./schema";
import { eq } from "drizzle-orm";

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
// Public API — application-level FTS5 sync
// ---------------------------------------------------------------------------

/**
 * Execute a SQL statement, silently ignoring "no such table" errors.
 * FTS5 virtual tables may not exist in test environments.
 */
function safeRun(stmt: ReturnType<typeof sql>): void {
  try {
    db.run(stmt);
  } catch (err) {
    // DrizzleError wraps SQLiteError in a `cause` property.
    // Swallow "no such table" — FTS5 tables may be absent in tests.
    const message =
      (err as { cause?: Error })?.cause?.message ?? (err as Error)?.message ?? "";
    if (message.includes("no such table")) return;
    throw err;
  }
}

/**
 * Synchronise a single note into the FTS5 index.
 * Call after INSERT, UPDATE, or DELETE of a note.
 *
 * For delete operations, pass the note's SQLite rowid explicitly via the
 * `rowid` parameter, because the note row is already removed from the DB.
 *
 * @param noteId - The note's UUID.
 * @param operation - "upsert" (insert or update) or "delete".
 * @param rowid - Required for "delete"; the note's SQLite rowid.
 */
export function syncNoteFts(
  noteId: string,
  operation: "upsert" | "delete",
  rowid?: number,
): void {
  if (operation === "delete") {
    if (rowid !== undefined) {
      safeRun(sql`DELETE FROM notes_fts WHERE rowid = ${rowid}`);
    }
    return;
  }

  // Upsert: find the note content and replace into FTS5
  const row = db
    .select({ rowid: sql<number>`rowid`, content: notes.content })
    .from(notes)
    .where(eq(notes.id, noteId))
    .get();
  if (!row) return;

  // Remove existing FTS entry first (FTS5 does not support REPLACE)
  safeRun(sql`DELETE FROM notes_fts WHERE rowid = ${row.rowid}`);
  safeRun(sql`INSERT INTO notes_fts(rowid, content) VALUES (${row.rowid}, ${row.content})`);
}

/**
 * Synchronise a single kanban task into the FTS5 index.
 * Call after INSERT, UPDATE, or DELETE of a task.
 *
 * For delete operations, pass the task's SQLite rowid explicitly via the
 * `rowid` parameter, because the task row is already removed from the DB.
 *
 * @param taskId - The task's UUID.
 * @param operation - "upsert" or "delete".
 * @param rowid - Required for "delete"; the task's SQLite rowid.
 */
export function syncTaskFts(
  taskId: string,
  operation: "upsert" | "delete",
  rowid?: number,
): void {
  if (operation === "delete") {
    if (rowid !== undefined) {
      safeRun(sql`DELETE FROM tasks_fts WHERE rowid = ${rowid}`);
    }
    return;
  }

  const row = db
    .select({
      rowid: sql<number>`rowid`,
      title: kanbanTasks.title,
      description: kanbanTasks.description,
    })
    .from(kanbanTasks)
    .where(eq(kanbanTasks.id, taskId))
    .get();
  if (!row) return;

  safeRun(sql`DELETE FROM tasks_fts WHERE rowid = ${row.rowid}`);
  safeRun(
    sql`INSERT INTO tasks_fts(rowid, title, description) VALUES (${row.rowid}, ${row.title}, ${row.description})`,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const statements = [CREATE_NOTES_FTS, CREATE_TASKS_FTS];

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
