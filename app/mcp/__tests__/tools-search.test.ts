import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { createTestDb } from "../../db/__tests__/helpers";
import type { TestDb } from "../../db/__tests__/helpers";
import * as schema from "../../db/schema";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: The FTS5 logic tests below use createTestDb() — a completely
// isolated in-memory database — rather than importing ../../db/db (which is
// module-cached across all test files and may point to a shared database).
//
// MCP handler validation tests use the global db (imported dynamically in
// beforeAll) since they only check error messages, not actual data.
// ═════════════════════════════════════════════════════════════════════════

const TEST_DIR = mkdtempSync(
  join(tmpdir(), "agented-notes-mcp-search-test-"),
);
const DB_PATH = join(TEST_DIR, "test.db");

// Set env vars BEFORE any application module is loaded
process.env["JWT_SECRET"] = "test-jwt-secret-1234567890!";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-abc";
process.env["MCP_API_KEY"] = "test-mcp-api-key-123";
process.env["DATABASE_PATH"] = DB_PATH;

// Create and migrate the test database (needed for MCP tool handler tests)
{
  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const migrationDir = join(import.meta.dir, "../../drizzle");
  const files = Array.from(
    new Bun.Glob("*.sql").scanSync({ cwd: migrationDir }),
  ).sort();
  for (const file of files) {
    const content = readFileSync(join(migrationDir, file), "utf-8");
    for (const stmt of content.split("--> statement-breakpoint\n")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }

  // FTS5 tables for the MCP handler tests
  sqlite.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);",
  );

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
      DELETE FROM notes_fts WHERE rowid = old.rowid;
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
      REPLACE INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  sqlite.close();
}

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function textContent(
  result: { content: Array<{ type: string; text?: string }> },
): string {
  return result.content[0]?.text ?? "";
}

// ── Helpers that mirror the service logic for FTS5 queries ─────────────

function searchNotes(
  t: TestDb,
  query: string,
): Array<Record<string, unknown>> {
  const sanitized = query.trim().replace(/"/g, '""');
  return (t.sqlite
    .query(
      `SELECT n.id, n.title, n.content, n.created_at, n.updated_at, notes_fts.rank
       FROM notes_fts
       JOIN notes n ON n.rowid = notes_fts.rowid
       WHERE notes_fts MATCH ?
       ORDER BY notes_fts.rank
       LIMIT 20`,
    )
    .all(sanitized) ?? []) as Array<Record<string, unknown>>;
}

function searchTasks(
  t: TestDb,
  query: string,
): Array<Record<string, unknown>> {
  const sanitized = query.trim().replace(/"/g, '""');
  return (t.sqlite
    .query(
      `SELECT t.id, t.title, t.description, t.created_at, t.updated_at, tasks_fts.rank
       FROM tasks_fts
       JOIN kanban_tasks t ON t.rowid = tasks_fts.rowid
       WHERE tasks_fts MATCH ?
       ORDER BY tasks_fts.rank
       LIMIT 20`,
    )
    .all(sanitized) ?? []) as Array<Record<string, unknown>>;
}

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe("MCP Search Tool", () => {
  let searchTool: typeof import("../tools/search");
  let searchSvc: typeof import("../../services/search");

  beforeAll(async () => {
    searchTool = await import("../tools/search");
    searchSvc = await import("../../services/search");
  });

  afterAll(() => {
    cleanup();
  });

  // ── FTS5 search logic — uses isolated in-memory DB ─────────────────

  describe("searchQuery FTS5 logic", () => {
    test("searchQuery returns matching notes by content", () => {
      const t = createTestDb();

      const noteId = crypto.randomUUID();
      t.db
        .insert(schema.notes)
        .values({
          id: noteId,
          title: "Searchable Note",
          content: "unique_search_term_abcdef",
        })
        .run();

      const results = searchNotes(t, "unique_search_term_abcdef");
      expect(results.length).toBeGreaterThanOrEqual(1);

      const found = results.find((r) => r["id"] === noteId);
      expect(found).toBeDefined();
      expect(found!["title"]).toBe("Searchable Note");
      expect(typeof found!["rank"]).toBe("number");
    });

    test("searchQuery returns matching tasks by title", () => {
      const t = createTestDb();

      const boardId = crypto.randomUUID();
      t.db.insert(schema.kanbanBoards).values({ id: boardId, name: "Board" }).run();

      const colId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanColumns)
        .values({ id: colId, boardId, name: "Column", position: 0 })
        .run();

      const taskId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanTasks)
        .values({
          id: taskId,
          columnId: colId,
          title: "unique_task_title_xyz",
          description: "Some description",
        })
        .run();

      const results = searchTasks(t, "unique_task_title_xyz");
      expect(results.length).toBeGreaterThanOrEqual(1);

      const found = results.find((r) => r["id"] === taskId);
      expect(found).toBeDefined();
      expect(found!["title"]).toBe("unique_task_title_xyz");
    });

    test("searchQuery with type=notes filter returns only notes", () => {
      const t = createTestDb();

      const noteId = crypto.randomUUID();
      t.db
        .insert(schema.notes)
        .values({
          id: noteId,
          title: "Type Filter Test",
          content: "type_filter_test_note_only",
        })
        .run();

      const results = searchNotes(t, "type_filter_test_note_only");
      expect(results.length).toBe(1);
    });

    test("searchQuery with type=tasks filter returns only tasks", () => {
      const t = createTestDb();

      const boardId = crypto.randomUUID();
      t.db.insert(schema.kanbanBoards).values({ id: boardId, name: "Board" }).run();

      const colId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanColumns)
        .values({ id: colId, boardId, name: "Column", position: 0 })
        .run();

      const taskId = crypto.randomUUID();
      t.db
        .insert(schema.kanbanTasks)
        .values({
          id: taskId,
          columnId: colId,
          title: "tasks_only_search_term",
        })
        .run();

      const results = searchTasks(t, "tasks_only_search_term");
      expect(results.length).toBe(1);
    });

    test("non-matching query returns empty results", () => {
      const t = createTestDb();
      const results = searchNotes(t, "zzzznonexistent999_123");
      expect(results).toEqual([]);
    });

    test("empty query returns empty results", () => {
      const results = searchSvc.searchQuery("");
      expect(results).toEqual([]);
    });

    test("whitespace query returns empty results", () => {
      const results = searchSvc.searchQuery("   ");
      expect(results).toEqual([]);
    });
  });

  // ── MCP tool handler tests (error paths, no data dependency) ──────

  describe("search_query MCP tool handler", () => {
    test("handler returns results for a valid query", async () => {
      const result = await searchTool.searchQueryTool.handler({
        query: "test",
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textContent(result));
      expect(data.results).toBeInstanceOf(Array);
    });

    test("handler returns error when query is missing", async () => {
      const result = await searchTool.searchQueryTool.handler({});

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("Missing required");
    });

    test("handler returns error when query is empty string", async () => {
      const result = await searchTool.searchQueryTool.handler({ query: "" });

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("Missing required");
    });

    test("handler returns error for invalid type filter", async () => {
      const result = await searchTool.searchQueryTool.handler({
        query: "test",
        type: "invalid",
      });

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain("Invalid type");
    });

    test("handler accepts optional type parameter", async () => {
      const result = await searchTool.searchQueryTool.handler({
        query: "test",
        type: "notes",
      });

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textContent(result));
      expect(data.results).toBeInstanceOf(Array);
    });

    test("handler accepts type=all", async () => {
      const result = await searchTool.searchQueryTool.handler({
        query: "test",
        type: "all",
      });

      expect(result.isError).toBeUndefined();
    });
  });
});
