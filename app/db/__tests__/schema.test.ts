import { expect, describe, test, beforeAll } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestDb } from "./helpers";
import type { TestDb } from "./helpers";
import * as schema from "../schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let t: TestDb;

const TABLES = [
  "users",
  "notes",
  "kanban_boards",
  "kanban_columns",
  "kanban_tasks",
  "calendar_events",
  "comments",
  "tags",
  "refresh_tokens",
  "notes_to_tags",
] as const;

const FTS_TABLES = ["notes_fts", "tasks_fts"] as const;

const TRIGGERS = [
  "notes_fts_ai",
  "notes_fts_ad",
  "notes_fts_au",
  "tasks_fts_ai",
  "tasks_fts_ad",
  "tasks_fts_au",
] as const;

function tableNames(): string[] {
  const rows = t.db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

function triggerNames(): string[] {
  const rows = t.db.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name`,
  );
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("database schema", () => {
  beforeAll(() => {
    t = createTestDb();
  });

  // ── Table existence ───────────────────────────────────────────────
  describe("tables exist", () => {
    for (const table of TABLES) {
      test(table, () => {
        const names = tableNames();
        expect(names).toContain(table);
      });
    }
  });

  // ── FTS5 virtual tables ──────────────────────────────────────────
  describe("FTS5 virtual tables", () => {
    for (const ft of FTS_TABLES) {
      test(`${ft} exists`, () => {
        const names = tableNames();
        expect(names).toContain(ft);
      });
    }

    test("notes_fts supports full-text search", () => {
      // Use a high rowid to avoid colliding with the auto-increment rowid
      // that notes_fts_ai trigger will use later.
      t.db.all(
        sql`INSERT INTO notes_fts(rowid, content) VALUES (999999, 'hello world')`,
      );
      const rows = t.db.all<{ content: string }>(
        sql`SELECT content FROM notes_fts WHERE notes_fts MATCH 'hello'`,
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Triggers ──────────────────────────────────────────────────────
  describe("triggers", () => {
    for (const tr of TRIGGERS) {
      test(`${tr} exists`, () => {
        const names = triggerNames();
        expect(names).toContain(tr);
      });
    }

    test("INSERT into notes syncs to notes_fts", () => {
      const noteId = crypto.randomUUID();
      t.db
        .insert(schema.notes)
        .values({
          id: noteId,
          title: "trigger test",
          content: "unique_searchable_content_xyz",
        })
        .run();

      const rows = t.db.all<{ content: string }>(
        sql`SELECT content FROM notes_fts WHERE notes_fts MATCH 'unique_searchable_content_xyz'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!.content).toBe("unique_searchable_content_xyz");
    });

    test("INSERT into kanban_tasks syncs to tasks_fts", () => {
      // FK chain: board → column → task
      const boardId = crypto.randomUUID();
      t.db.insert(schema.kanbanBoards).values({ id: boardId, name: "Board" }).run();
      const colId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanColumns)
        .values({ id: colId, boardId, name: "Col", position: 0 })
        .run();

      const taskId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanTasks)
        .values({
          id: taskId,
          columnId: colId,
          title: "FTS task",
          description: "fts_description_test",
        })
        .run();

      const rows = t.db.all<{ title: string; description: string }>(
        sql`SELECT title, description FROM tasks_fts WHERE tasks_fts MATCH 'fts_description_test'`,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]!.description).toBe("fts_description_test");
    });
  });

  // ── Basic CRUD ────────────────────────────────────────────────────
  describe("CRUD", () => {
    test("users — insert and select", () => {
      const id = crypto.randomUUID();
      t.db.insert(schema.users).values({ id, username: "alice" }).run();
      const rows = t.db
        .select()
        .from(schema.users)
        .where(sql`id = ${id}`)
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0]!.username).toBe("alice");
    });

    test("users — update", () => {
      const id = crypto.randomUUID();
      t.db.insert(schema.users).values({ id, username: "bob" }).run();
      t.db
        .update(schema.users)
        .set({ username: "bob_updated" })
        .where(sql`id = ${id}`)
        .run();
      const rows = t.db
        .select()
        .from(schema.users)
        .where(sql`id = ${id}`)
        .all();
      expect(rows[0]!.username).toBe("bob_updated");
    });

    test("users — delete", () => {
      const id = crypto.randomUUID();
      t.db.insert(schema.users).values({ id, username: "charlie" }).run();
      t.db
        .delete(schema.users)
        .where(sql`id = ${id}`)
        .run();
      const rows = t.db
        .select()
        .from(schema.users)
        .where(sql`id = ${id}`)
        .all();
      expect(rows.length).toBe(0);
    });

    test("notes — insert and select", () => {
      const id = crypto.randomUUID();
      t.db
        .insert(schema.notes)
        .values({ id, title: "Note", content: "Hello" })
        .run();
      const rows = t.db
        .select()
        .from(schema.notes)
        .where(sql`id = ${id}`)
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0]!.title).toBe("Note");
    });

    test("kanban_boards — insert and select", () => {
      const id = crypto.randomUUID();
      t.db.insert(schema.kanbanBoards).values({ id, name: "Project Alpha" }).run();
      const rows = t.db
        .select()
        .from(schema.kanbanBoards)
        .where(sql`id = ${id}`)
        .all();
      expect(rows[0]!.name).toBe("Project Alpha");
    });

    test("kanban_columns — insert with FK", () => {
      const boardId = crypto.randomUUID();
      t.db.insert(schema.kanbanBoards).values({ id: boardId, name: "B" }).run();
      const colId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanColumns)
        .values({ id: colId, boardId, name: "To Do", position: 1 })
        .run();
      const rows = t.db
        .select()
        .from(schema.kanbanColumns)
        .where(sql`id = ${colId}`)
        .all();
      expect(rows[0]!.name).toBe("To Do");
    });

    test("kanban_tasks — insert with FK", () => {
      const boardId = crypto.randomUUID();
      t.db.insert(schema.kanbanBoards).values({ id: boardId, name: "B2" }).run();
      const colId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanColumns)
        .values({ id: colId, boardId, name: "Done", position: 2 })
        .run();
      const taskId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanTasks)
        .values({ id: taskId, columnId: colId, title: "Ship it" })
        .run();
      const rows = t.db
        .select()
        .from(schema.kanbanTasks)
        .where(sql`id = ${taskId}`)
        .all();
      expect(rows[0]!.title).toBe("Ship it");
      expect(rows[0]!.tags).toBe("[]");
    });

    test("calendar_events — insert", () => {
      const id = crypto.randomUUID();
      t.db
        .insert(schema.calendarEvents)
        .values({ id, title: "Meeting", startDate: "2026-07-24T10:00:00Z" })
        .run();
      const rows = t.db
        .select()
        .from(schema.calendarEvents)
        .where(sql`id = ${id}`)
        .all();
      expect(rows[0]!.title).toBe("Meeting");
      expect(rows[0]!.allDay).toBe(0);
    });

    test("comments — insert with entity_type", () => {
      const id = crypto.randomUUID();
      t.db
        .insert(schema.comments)
        .values({
          id,
          entityType: "note",
          entityId: crypto.randomUUID(),
          content: "Great note!",
        })
        .run();
      const rows = t.db
        .select()
        .from(schema.comments)
        .where(sql`id = ${id}`)
        .all();
      expect(rows[0]!.content).toBe("Great note!");
      expect(rows[0]!.status).toBe("pending");
    });

    test("tags — unique constraint", () => {
      const id1 = crypto.randomUUID();
      t.db.insert(schema.tags).values({ id: id1, name: "unique-tag" }).run();

      const id2 = crypto.randomUUID();
      expect(() => {
        t.db.insert(schema.tags).values({ id: id2, name: "unique-tag" }).run();
      }).toThrow();
    });

    test("refresh_tokens — insert", () => {
      const userId = crypto.randomUUID();
      t.db.insert(schema.users).values({ id: userId, username: "tokenuser" }).run();
      const id = crypto.randomUUID();
      t.db
        .insert(schema.refreshTokens)
        .values({
          id,
          tokenHash: "abc123hash",
          userId,
          expiresAt: "2026-08-24T00:00:00Z",
        })
        .run();
      const rows = t.db
        .select()
        .from(schema.refreshTokens)
        .where(sql`id = ${id}`)
        .all();
      expect(rows[0]!.tokenHash).toBe("abc123hash");
    });

    test("notes_to_tags — junction table insert", () => {
      const noteId = crypto.randomUUID();
      t.db.insert(schema.notes).values({ id: noteId, title: "Junction Note" }).run();
      const tagId = crypto.randomUUID();
      t.db.insert(schema.tags).values({ id: tagId, name: "junction-tag" }).run();

      t.db.insert(schema.notesToTags).values({ noteId, tagId }).run();
      const rows = t.db
        .select()
        .from(schema.notesToTags)
        .where(sql`note_id = ${noteId}`)
        .all();
      expect(rows.length).toBe(1);
      expect(rows[0]!.tagId).toBe(tagId);
    });
  });
});
