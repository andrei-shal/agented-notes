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
// module-cached across all test files and points to a shared database).
// This avoids cross-contamination from other test files.
//
// API-level tests (400/401) use the shared api.fetch() since they only
// check status codes, not data.
// ═════════════════════════════════════════════════════════════════════════

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-search-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

// Set env vars BEFORE any application module is loaded
process.env["JWT_SECRET"] = "test-jwt-secret-1234567890!";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-abc";
process.env["MCP_API_KEY"] = "test-mcp-api-key-123";
process.env["DATABASE_PATH"] = DB_PATH;

// Create and migrate the test database (needed for api.fetch() tests)
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

  sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);");
  sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description);");

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
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON kanban_tasks BEGIN
      INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON kanban_tasks BEGIN
      DELETE FROM tasks_fts WHERE rowid = old.rowid;
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON kanban_tasks BEGIN
      REPLACE INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
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

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe("Search API", () => {
  let api: Awaited<typeof import("../../api/index")>["api"];
  let token: string;

  beforeAll(async () => {
    const apiModule = await import("../../api/index");
    api = apiModule.api;

    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();
    token = await jwt.generateAccessToken("test-user-id");
  });

  afterAll(() => {
    cleanup();
  });

  // ── FTS5 logic — uses isolated in-memory DB ────────────────────────

  describe("FTS5 search logic", () => {
    /**
     * Helper: run the same FTS5 search SQL that the API uses, on an
     * isolated in-memory database.  Returns the raw result rows.
     */
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

    test("search notes by content", () => {
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

    test("search with type=notes filter returns only notes", () => {
      const t = createTestDb();

      const noteId = crypto.randomUUID();
      t.db
        .insert(schema.notes)
        .values({
          id: noteId,
          title: "Only Note Search",
          content: "type_filter_test_note_only",
        })
        .run();

      const results = searchNotes(t, "type_filter_test_note_only");
      expect(results.length).toBe(1);
    });

    test("search tasks by title", () => {
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

    test("non-matching query returns empty results", () => {
      const t = createTestDb();
      const results = searchNotes(t, "zzzznonexistent999_123");
      expect(results).toEqual([]);
    });
  });

  // ── API-level tests (status codes) ─────────────────────────────────

  describe("API endpoint behavior", () => {
    test("GET /api/search without q returns 400", async () => {
      const res = await api.fetch(
        new Request("http://localhost/api/search", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    test("GET /api/search?q= (blank) returns 400", async () => {
      const res = await api.fetch(
        new Request("http://localhost/api/search?q=", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(res.status).toBe(400);
    });

    test("GET /api/search?q=hello&type=invalid returns 400", async () => {
      const res = await api.fetch(
        new Request("http://localhost/api/search?q=hello&type=invalid", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        }),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid type");
    });

    test("GET /api/search without bearer token returns 401", async () => {
      const res = await api.fetch(
        new Request("http://localhost/api/search?q=hello", {
          method: "GET",
        }),
      );

      expect(res.status).toBe(401);
    });
  });
});
