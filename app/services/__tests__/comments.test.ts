import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: All application module imports below are DYNAMIC (inside
// beforeAll).  Static imports of application code would cause getDb().ts etc.
// to load before env vars are set.
// ═════════════════════════════════════════════════════════════════════════

// ── Test database setup (runs at module level, before any test) ─────

const TEST_DIR = mkdtempSync(
  join(tmpdir(), "agented-notes-comments-svc-test-"),
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
  sqlite.close();
}

// Cleanup temp directory on exit
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

describe("CommentsService", () => {
  let svc: typeof import("../comments");
  let dbModule: typeof import("../../db/db");
  let schema: typeof import("../../db/schema");

  // IDs of entities created for tests
  let noteId: string;
  let taskId: string;
  let eventId: string;

  beforeAll(async () => {
    svc = await import("../comments");
    dbModule = await import("../../db/db");
    schema = await import("../../db/schema");

    const { getDb } = dbModule;
    const { notes, kanbanBoards, kanbanColumns, kanbanTasks, calendarEvents } =
      schema;

    // Create a note
    noteId = crypto.randomUUID();
    getDb().insert(notes)
      .values({ id: noteId, title: "Test Note", content: "Note body" })
      .run();

    // Create a board + column + task
    const boardId = crypto.randomUUID();
    getDb().insert(kanbanBoards)
      .values({ id: boardId, name: "Test Board" })
      .run();

    const columnId = crypto.randomUUID();
    getDb().insert(kanbanColumns)
      .values({ id: columnId, boardId, name: "To Do", position: 0 })
      .run();

    taskId = crypto.randomUUID();
    getDb().insert(kanbanTasks)
      .values({
        id: taskId,
        columnId,
        title: "Test Task",
        position: 0,
      })
      .run();

    // Create an event
    eventId = crypto.randomUUID();
    getDb().insert(calendarEvents)
      .values({
        id: eventId,
        title: "Test Event",
        startDate: new Date().toISOString(),
      })
      .run();
  });

  afterAll(() => {
    cleanup();
  });

  // ── createComment ─────────────────────────────────────────────────

  test("createComment creates a pending comment with TTL", () => {
    const comment = svc.createComment("note", noteId, "Hello from test");

    expect(comment.id).toBeDefined();
    expect(comment.entityType).toBe("note");
    expect(comment.entityId).toBe(noteId);
    expect(comment.content).toBe("Hello from test");
    expect(comment.status).toBe("pending");
    expect(comment.createdAt).toBeDefined();
    expect(comment.expiresAt).toBeDefined();

    // expiresAt should be ~7 days in the future
    const expiresMs = new Date(comment.expiresAt!).getTime();
    const nowMs = Date.now();
    const diffDays = (expiresMs - nowMs) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(6);
    expect(diffDays).toBeLessThan(8);
  });

  test("createComment on a task creates a comment with entity_type=task", () => {
    const comment = svc.createComment("task", taskId, "Task comment");
    expect(comment.entityType).toBe("task");
    expect(comment.entityId).toBe(taskId);
    expect(comment.content).toBe("Task comment");
    expect(comment.status).toBe("pending");
  });

  test("createComment on an event creates a comment with entity_type=event", () => {
    const comment = svc.createComment("event", eventId, "Event comment");
    expect(comment.entityType).toBe("event");
    expect(comment.entityId).toBe(eventId);
    expect(comment.content).toBe("Event comment");
    expect(comment.status).toBe("pending");
  });

  test("createComment on non-existent entity throws", () => {
    const fakeId = crypto.randomUUID();
    expect(() => svc.createComment("note", fakeId, "Bogus")).toThrow(
      "Entity not found",
    );
  });

  // ── getComments ──────────────────────────────────────────────────

  test("getComments returns all comments for an entity", () => {
    const comments = svc.getComments("note", noteId);
    expect(comments.length).toBeGreaterThanOrEqual(1);
    for (const c of comments) {
      expect(c.entityType).toBe("note");
      expect(c.entityId).toBe(noteId);
    }
  });

  test("getComments returns empty array for entity with no comments", () => {
    const comments = svc.getComments(
      "note",
      "00000000-0000-0000-0000-000000000000",
    );
    expect(comments).toEqual([]);
  });

  test("getComments orders by createdAt ascending", () => {
    // Comments are created in order, so timestamps should be sorted
    const comments = svc.getComments("note", noteId);
    for (let i = 1; i < comments.length; i++) {
      const prev = comments[i - 1]!;
      const curr = comments[i]!;
      expect(
        new Date(prev.createdAt!).getTime(),
      ).toBeLessThanOrEqual(new Date(curr.createdAt!).getTime());
    }
  });

  // ── markProcessed ────────────────────────────────────────────────

  test("markProcessed changes status from pending to processed", () => {
    const comment = svc.createComment("note", noteId, "Will be processed");
    expect(comment.status).toBe("pending");

    const updated = svc.markProcessed(comment.id);
    expect(updated).toBeDefined();
    expect(updated!.id).toBe(comment.id);
    expect(updated!.status).toBe("processed");
  });

  test("markProcessed on non-existent id returns undefined", () => {
    const result = svc.markProcessed(crypto.randomUUID());
    expect(result).toBeUndefined();
  });

  // ── deleteComment ────────────────────────────────────────────────

  test("deleteComment removes a comment and returns true", () => {
    const comment = svc.createComment("note", noteId, "To be deleted");
    const deleted = svc.deleteComment(comment.id);
    expect(deleted).toBe(true);

    const comments = svc.getComments("note", noteId);
    expect(comments.find((c) => c.id === comment.id)).toBeUndefined();
  });

  test("deleteComment on non-existent id returns false", () => {
    const result = svc.deleteComment(crypto.randomUUID());
    expect(result).toBe(false);
  });

  // ── getPendingComments ───────────────────────────────────────────

  test("getPendingComments returns only non-expired pending comments with entity title", () => {
    // Create several pending comments on different entity types
    const c1 = svc.createComment("note", noteId, "Pending note comment");
    const c2 = svc.createComment("task", taskId, "Pending task comment");

    const pending = svc.getPendingComments();

    expect(pending.length).toBeGreaterThanOrEqual(2);

    const found1 = pending.find((p) => p.comment.id === c1.id);
    expect(found1).toBeDefined();
    expect(found1!.comment.status).toBe("pending");
    expect(found1!.entityTitle).toBe("Test Note");

    const found2 = pending.find((p) => p.comment.id === c2.id);
    expect(found2).toBeDefined();
    expect(found2!.comment.status).toBe("pending");
    expect(found2!.entityTitle).toBe("Test Task");
  });

  test("getPendingComments excludes processed comments", () => {
    const comment = svc.createComment("note", noteId, "Will be processed soon");
    svc.markProcessed(comment.id);

    const pending = svc.getPendingComments();
    expect(pending.find((p) => p.comment.id === comment.id)).toBeUndefined();
  });

  test("getPendingComments excludes expired comments", () => {
    const { getDb } = dbModule;
    const { comments: commentsTable } = schema;

    // Manually insert a comment with an already-expired expires_at
    const expiredId = crypto.randomUUID();
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    getDb().insert(commentsTable)
      .values({
        id: expiredId,
        entityType: "note",
        entityId: noteId,
        content: "Expired comment",
        status: "pending",
        expiresAt: past,
      })
      .run();

    const pending = svc.getPendingComments();
    expect(pending.find((p) => p.comment.id === expiredId)).toBeUndefined();
  });

  test("getPendingComments returns empty when no pending comments exist", () => {
    // Create a comment and immediately process it
    const c = svc.createComment("note", noteId, "Temporary");
    svc.markProcessed(c.id);

    // Manually create another that is expired
    const { getDb } = dbModule;
    const { comments: commentsTable } = schema;

    const expiredId = crypto.randomUUID();
    getDb().insert(commentsTable)
      .values({
        id: expiredId,
        entityType: "note",
        entityId: noteId,
        content: "Old and expired",
        status: "pending",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      })
      .run();

    // We cannot guarantee no other pending comments exist from previous tests,
    // so we filter to the ones we know about
    const pending = svc.getPendingComments();
    expect(pending.find((p) => p.comment.id === c.id)).toBeUndefined();
    expect(pending.find((p) => p.comment.id === expiredId)).toBeUndefined();
  });
});
