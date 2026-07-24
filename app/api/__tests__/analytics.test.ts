import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: All application module imports below are DYNAMIC (inside
// beforeAll).  Static imports of application code would cause db.ts etc.
// to load before env vars are set.
// ═════════════════════════════════════════════════════════════════════════

// ── Test database setup (runs at module level, before any test) ─────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-analytics-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

// Set env vars BEFORE any application module is loaded
process.env["JWT_SECRET"] = "test-jwt-secret-1234567890!";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-abc";
process.env["MCP_API_KEY"] = "test-mcp-api-key-123";
process.env["DATABASE_PATH"] = DB_PATH;

// Create and migrate the test database
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

  // FTS5 tables (not directly needed for analytics, but required by schema)
  sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);");
  sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description);");

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ai AFTER INSERT ON kanban_tasks BEGIN
      INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_fts_ad AFTER DELETE ON kanban_tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
    END;
  `);
  sqlite.exec(`
    CREATE TRIGGER IF NOT EXISTS tasks_fts_au AFTER UPDATE ON kanban_tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, old.description);
      INSERT INTO tasks_fts(rowid, title, description) VALUES (new.rowid, new.title, new.description);
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

describe("Analytics API", () => {
  let api: Awaited<typeof import("../../api/index")>["api"];
  let generateAccessToken: (userId: string) => Promise<string>;
  let token: string;

  beforeAll(async () => {
    const apiModule = await import("../../api/index");
    api = apiModule.api;

    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();
    generateAccessToken = jwt.generateAccessToken;

    token = await generateAccessToken("test-user-id");
  });

  afterAll(() => {
    cleanup();
  });

  // ── Stats ─────────────────────────────────────────────────────────

  test("GET /api/analytics/stats returns expected shape", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/stats", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total_notes");
    expect(body).toHaveProperty("total_tasks");
    expect(body).toHaveProperty("tasks_by_column");
    expect(body).toHaveProperty("total_events");
    expect(body).toHaveProperty("comments");
    expect(body).toHaveProperty("total_tags");
    expect(Array.isArray(body.tasks_by_column)).toBe(true);
    expect(Array.isArray(body.comments)).toBe(true);
  });

  test("GET /api/analytics/stats reflects newly seeded data", async () => {
    const dbModule = await import("../../db/db");
    const schema = await import("../../db/schema");
    const today = new Date().toISOString();

    // Record baseline
    const baseline = await api.fetch(
      new Request("http://localhost/api/analytics/stats", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const baselineBody = await baseline.json();
    const baseNotes = baselineBody.total_notes as number;
    const baseTasks = baselineBody.total_tasks as number;
    const baseEvents = baselineBody.total_events as number;
    const baseTags = baselineBody.total_tags as number;

    // Create 2 notes
    dbModule.getDb()
      .insert(schema.notes)
      .values({ id: crypto.randomUUID(), title: "Note 1", content: "Content 1", createdAt: today })
      .run();
    dbModule.getDb()
      .insert(schema.notes)
      .values({ id: crypto.randomUUID(), title: "Note 2", content: "Content 2", createdAt: today })
      .run();

    // Create board + 2 columns
    const boardId = crypto.randomUUID();
    dbModule.getDb().insert(schema.kanbanBoards).values({ id: boardId, name: "Board" }).run();

    const col1Id = crypto.randomUUID();
    dbModule.getDb()
      .insert(schema.kanbanColumns)
      .values({ id: col1Id, boardId, name: "To Do", position: 0 })
      .run();

    const col2Id = crypto.randomUUID();
    dbModule.getDb()
      .insert(schema.kanbanColumns)
      .values({ id: col2Id, boardId, name: "Done", position: 1 })
      .run();

    // Create 3 tasks: 2 in col1, 1 in col2
    dbModule.getDb()
      .insert(schema.kanbanTasks)
      .values({ id: crypto.randomUUID(), columnId: col1Id, title: "Task 1", createdAt: today })
      .run();
    dbModule.getDb()
      .insert(schema.kanbanTasks)
      .values({ id: crypto.randomUUID(), columnId: col1Id, title: "Task 2", createdAt: today })
      .run();
    dbModule.getDb()
      .insert(schema.kanbanTasks)
      .values({ id: crypto.randomUUID(), columnId: col2Id, title: "Task 3", createdAt: today })
      .run();

    // Create 1 event
    dbModule.getDb()
      .insert(schema.calendarEvents)
      .values({ id: crypto.randomUUID(), title: "Event 1", startDate: today })
      .run();

    // Create 2 comments: 1 pending, 1 processed
    dbModule.getDb()
      .insert(schema.comments)
      .values({
        id: crypto.randomUUID(),
        entityType: "note",
        entityId: crypto.randomUUID(),
        content: "Pending comment",
        status: "pending",
      })
      .run();
    dbModule.getDb()
      .insert(schema.comments)
      .values({
        id: crypto.randomUUID(),
        entityType: "note",
        entityId: crypto.randomUUID(),
        content: "Processed comment",
        status: "processed",
      })
      .run();

    // Create 2 tags
    dbModule.getDb().insert(schema.tags).values({ id: crypto.randomUUID(), name: "tag-a" }).run();
    dbModule.getDb().insert(schema.tags).values({ id: crypto.randomUUID(), name: "tag-b" }).run();

    // Now fetch stats
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/stats", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    // Check deltas from baseline
    expect(body.total_notes).toBe(baseNotes + 2);
    expect(body.total_tasks).toBe(baseTasks + 3);
    expect(body.total_events).toBe(baseEvents + 1);
    expect(body.total_tags).toBe(baseTags + 2);

    // Comments — should have at least 1 pending + 1 processed
    const pendingStatus = body.comments.find(
      (c: Record<string, unknown>) => c["status"] === "pending",
    );
    const processedStatus = body.comments.find(
      (c: Record<string, unknown>) => c["status"] === "processed",
    );
    expect(pendingStatus).toBeDefined();
    expect((pendingStatus as Record<string, unknown>)!["count"]).toBeGreaterThanOrEqual(1);
    expect(processedStatus).toBeDefined();
    expect((processedStatus as Record<string, unknown>)!["count"]).toBeGreaterThanOrEqual(1);

    // Tasks by column breakdown
    const col1Entry = body.tasks_by_column.find(
      (t: Record<string, unknown>) => t["column_id"] === col1Id,
    );
    const col2Entry = body.tasks_by_column.find(
      (t: Record<string, unknown>) => t["column_id"] === col2Id,
    );
    expect(col1Entry).toBeDefined();
    expect((col1Entry as Record<string, unknown>)!["count"]).toBe(2);
    expect(col2Entry).toBeDefined();
    expect((col2Entry as Record<string, unknown>)!["count"]).toBe(1);
  });

  // ── Tags frequency ────────────────────────────────────────────────

  test("GET /api/analytics/tags returns tags with usage counts", async () => {
    const dbModule = await import("../../db/db");
    const schema = await import("../../db/schema");
    const analyticTagName = `test-tag-${crypto.randomUUID().slice(0, 8)}`;

    // Create a unique tag
    const tagId = crypto.randomUUID();
    dbModule.getDb().insert(schema.tags).values({ id: tagId, name: analyticTagName }).run();

    // Create a note linked to this tag
    const noteId = crypto.randomUUID();
    dbModule.getDb()
      .insert(schema.notes)
      .values({ id: noteId, title: "Tagged Note", content: "Tags" })
      .run();
    dbModule.getDb().insert(schema.notesToTags).values({ noteId, tagId }).run();

    // Fetch tags
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/tags", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toBeDefined();
    expect(Array.isArray(body.tags)).toBe(true);

    // Verify our unique tag has count 1
    const ourTag = body.tags.find(
      (t: Record<string, unknown>) => t["name"] === analyticTagName,
    );
    expect(ourTag).toBeDefined();
    expect((ourTag as Record<string, unknown>)!["count"]).toBe(1);
  });

  // ── Activity ──────────────────────────────────────────────────────

  test("GET /api/analytics/activity returns daily activity for last 30 days", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/activity", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity).toBeDefined();
    expect(Array.isArray(body.activity)).toBe(true);

    // Today should have entries from the seeded data
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayEntry = body.activity.find(
      (a: Record<string, unknown>) => a["date"] === todayStr,
    );
    expect(todayEntry).toBeDefined();
    expect(typeof (todayEntry as Record<string, unknown>)!["notes_created"]).toBe("number");
    expect(typeof (todayEntry as Record<string, unknown>)!["tasks_created"]).toBe("number");
    // We created 2 notes + 1 tagged note = 3 and 3 tasks
    expect((todayEntry as Record<string, unknown>)!["notes_created"]).toBeGreaterThanOrEqual(2);
    expect((todayEntry as Record<string, unknown>)!["tasks_created"]).toBeGreaterThanOrEqual(3);
  });

  // ── Auth protection ───────────────────────────────────────────────

  test("GET /api/analytics/stats without bearer token returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/stats", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(401);
  });

  test("GET /api/analytics/tags without bearer token returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/tags", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(401);
  });

  test("GET /api/analytics/activity without bearer token returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/analytics/activity", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(401);
  });
});
