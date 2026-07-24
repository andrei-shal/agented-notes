import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: All application module imports below are DYNAMIC (inside
// beforeAll) because env vars must be set BEFORE static import evaluation.
// ═════════════════════════════════════════════════════════════════════════

const TEST_DIR = mkdtempSync(
  join(tmpdir(), "agented-notes-mcp-analytics-test-"),
);
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

  // FTS5 tables (not directly needed for analytics, but required by schema
  // triggers)
  sqlite.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);",
  );
  sqlite.exec(
    "CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description);",
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

function textContent(
  result: { content: Array<{ type: string; text?: string }> },
): string {
  return result.content[0]?.text ?? "";
}

describe("MCP Analytics Tools", () => {
  let analyticsTool: typeof import("../tools/analytics");
  let analyticsSvc: typeof import("../../services/analytics");
  let dbModule: typeof import("../../db/db");
  let schema: typeof import("../../db/schema");

  beforeAll(async () => {
    analyticsTool = await import("../tools/analytics");
    analyticsSvc = await import("../../services/analytics");
    dbModule = await import("../../db/db");
    schema = await import("../../db/schema");
  });

  afterAll(() => {
    cleanup();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Service-level tests
  // ═══════════════════════════════════════════════════════════════════════

  describe("analytics service — getStats", () => {
    test("getStats returns expected shape with zeros", () => {
      const stats = analyticsSvc.getStats();

      expect(stats).toHaveProperty("total_notes");
      expect(stats).toHaveProperty("total_tasks");
      expect(stats).toHaveProperty("tasks_by_column");
      expect(stats).toHaveProperty("total_events");
      expect(stats).toHaveProperty("comments");
      expect(stats).toHaveProperty("total_tags");
      expect(Array.isArray(stats.tasks_by_column)).toBe(true);
      expect(Array.isArray(stats.comments)).toBe(true);
    });

    test("getStats reflects newly seeded data", () => {
      const baseline = analyticsSvc.getStats();

      // Create 2 notes
      dbModule.db
        .insert(schema.notes)
        .values({
          id: crypto.randomUUID(),
          title: "Note 1",
          content: "Content 1",
        })
        .run();
      dbModule.db
        .insert(schema.notes)
        .values({
          id: crypto.randomUUID(),
          title: "Note 2",
          content: "Content 2",
        })
        .run();

      // Create board + 2 columns
      const boardId = crypto.randomUUID();
      dbModule.db
        .insert(schema.kanbanBoards)
        .values({ id: boardId, name: "Board" })
        .run();

      const col1Id = crypto.randomUUID();
      dbModule.db
        .insert(schema.kanbanColumns)
        .values({ id: col1Id, boardId, name: "To Do", position: 0 })
        .run();

      const col2Id = crypto.randomUUID();
      dbModule.db
        .insert(schema.kanbanColumns)
        .values({ id: col2Id, boardId, name: "Done", position: 1 })
        .run();

      // Create 3 tasks: 2 in col1, 1 in col2
      dbModule.db
        .insert(schema.kanbanTasks)
        .values({
          id: crypto.randomUUID(),
          columnId: col1Id,
          title: "Task 1",
        })
        .run();
      dbModule.db
        .insert(schema.kanbanTasks)
        .values({
          id: crypto.randomUUID(),
          columnId: col1Id,
          title: "Task 2",
        })
        .run();
      dbModule.db
        .insert(schema.kanbanTasks)
        .values({
          id: crypto.randomUUID(),
          columnId: col2Id,
          title: "Task 3",
        })
        .run();

      // Create 1 event
      dbModule.db
        .insert(schema.calendarEvents)
        .values({
          id: crypto.randomUUID(),
          title: "Event 1",
          startDate: new Date().toISOString(),
        })
        .run();

      // Create 2 comments: 1 pending, 1 processed
      dbModule.db
        .insert(schema.comments)
        .values({
          id: crypto.randomUUID(),
          entityType: "note",
          entityId: crypto.randomUUID(),
          content: "Pending comment",
          status: "pending",
        })
        .run();
      dbModule.db
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
      dbModule.db
        .insert(schema.tags)
        .values({ id: crypto.randomUUID(), name: "tag-a" })
        .run();
      dbModule.db
        .insert(schema.tags)
        .values({ id: crypto.randomUUID(), name: "tag-b" })
        .run();

      const stats = analyticsSvc.getStats();

      expect(stats.total_notes).toBe(baseline.total_notes + 2);
      expect(stats.total_tasks).toBe(baseline.total_tasks + 3);
      expect(stats.total_events).toBe(baseline.total_events + 1);
      expect(stats.total_tags).toBe(baseline.total_tags + 2);

      // Comments — should have 1 pending + 1 processed
      const pendingStatus = stats.comments.find(
        (c) => c.status === "pending",
      );
      const processedStatus = stats.comments.find(
        (c) => c.status === "processed",
      );
      expect(pendingStatus).toBeDefined();
      expect(pendingStatus!.count).toBeGreaterThanOrEqual(1);
      expect(processedStatus).toBeDefined();
      expect(processedStatus!.count).toBeGreaterThanOrEqual(1);

      // Tasks by column breakdown
      const col1Entry = stats.tasks_by_column.find(
        (t) => t.column_id === col1Id,
      );
      const col2Entry = stats.tasks_by_column.find(
        (t) => t.column_id === col2Id,
      );
      expect(col1Entry).toBeDefined();
      expect(col1Entry!.count).toBe(2);
      expect(col2Entry).toBeDefined();
      expect(col2Entry!.count).toBe(1);
    });
  });

  describe("analytics service — getTags", () => {
    test("getTags returns tags with usage counts", () => {
      const tagName = `test-tag-${crypto.randomUUID().slice(0, 8)}`;

      // Create a unique tag
      const tagId = crypto.randomUUID();
      dbModule.db
        .insert(schema.tags)
        .values({ id: tagId, name: tagName })
        .run();

      // Create a note linked to this tag
      const noteId = crypto.randomUUID();
      dbModule.db
        .insert(schema.notes)
        .values({ id: noteId, title: "Tagged Note", content: "Tags" })
        .run();
      dbModule.db
        .insert(schema.notesToTags)
        .values({ noteId, tagId })
        .run();

      const tagList = analyticsSvc.getTags();
      expect(Array.isArray(tagList)).toBe(true);

      const ourTag = tagList.find((t) => t.name === tagName);
      expect(ourTag).toBeDefined();
      expect(ourTag!.count).toBe(1);
    });
  });

  describe("analytics service — getActivity", () => {
    test("getActivity returns daily activity array", () => {
      const activity = analyticsSvc.getActivity();
      expect(Array.isArray(activity)).toBe(true);

      if (activity.length > 0) {
        const entry = activity[0]!;
        expect(entry).toHaveProperty("date");
        expect(entry).toHaveProperty("notes_created");
        expect(entry).toHaveProperty("tasks_created");
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // MCP tool handler tests
  // ═══════════════════════════════════════════════════════════════════════

  describe("analytics_stats MCP tool handler", () => {
    test("handler returns stats with expected shape", async () => {
      const result =
        await analyticsTool.analyticsStatsTool.handler({});

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const data = JSON.parse(textContent(result));
      expect(data).toHaveProperty("total_notes");
      expect(data).toHaveProperty("total_tasks");
      expect(data).toHaveProperty("tasks_by_column");
      expect(data).toHaveProperty("total_events");
      expect(data).toHaveProperty("comments");
      expect(data).toHaveProperty("total_tags");
    });
  });

  describe("analytics_tags MCP tool handler", () => {
    test("handler returns tags array", async () => {
      const result = await analyticsTool.analyticsTagsTool.handler({});

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const data = JSON.parse(textContent(result));
      expect(data.tags).toBeInstanceOf(Array);
    });
  });

  describe("analytics_activity MCP tool handler", () => {
    test("handler returns activity array", async () => {
      const result =
        await analyticsTool.analyticsActivityTool.handler({});

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const data = JSON.parse(textContent(result));
      expect(data.activity).toBeInstanceOf(Array);
    });
  });
});
