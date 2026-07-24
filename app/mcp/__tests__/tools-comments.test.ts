import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: Static imports of application code above are safe as long as
// env vars are set BEFORE the first import of any module that reads them.
// All db-dependent modules are imported dynamically inside beforeAll.
// ═════════════════════════════════════════════════════════════════════════

// ── Test database setup (runs at module level, before any test) ─────

const TEST_DIR = mkdtempSync(
  join(tmpdir(), "agented-notes-mcp-comments-test-"),
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

function textContent(
  result: { content: Array<{ type: string; text?: string }> },
): string {
  return result.content[0]?.text ?? "";
}

describe("MCP Comments Tools", () => {
  let tools: typeof import("../tools/comments");
  let svc: typeof import("../../services/comments");
  let dbModule: typeof import("../../db/db");
  let schema: typeof import("../../db/schema");

  let noteId: string;
  let taskId: string;

  beforeAll(async () => {
    tools = await import("../tools/comments");
    svc = await import("../../services/comments");
    dbModule = await import("../../db/db");
    schema = await import("../../db/schema");

    const { getDb } = dbModule;
    const { notes, kanbanBoards, kanbanColumns, kanbanTasks } = schema;

    // Create a note
    noteId = crypto.randomUUID();
    getDb().insert(notes)
      .values({ id: noteId, title: "MCP Test Note", content: "Note body" })
      .run();

    // Create a board + column + task
    const boardId = crypto.randomUUID();
    getDb().insert(kanbanBoards)
      .values({ id: boardId, name: "MCP Test Board" })
      .run();

    const columnId = crypto.randomUUID();
    getDb().insert(kanbanColumns)
      .values({ id: columnId, boardId, name: "To Do", position: 0 })
      .run();

    taskId = crypto.randomUUID();
    getDb().insert(kanbanTasks)
      .values({ id: taskId, columnId, title: "MCP Test Task", position: 0 })
      .run();
  });

  afterAll(() => {
    cleanup();
  });

  // ── comments_get_pending ──────────────────────────────────────────

  test("comments_get_pending returns empty array when no pending comments exist", async () => {
    const result = await tools.commentsGetPendingTool.handler({});

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });

    const data = JSON.parse(textContent(result));
    expect(data).toBeInstanceOf(Array);
  });

  test("comments_get_pending returns pending comments with entity titles", async () => {
    const c1 = svc.createComment("note", noteId, "MCP pending note comment");
    const c2 = svc.createComment("task", taskId, "MCP pending task comment");

    const result = await tools.commentsGetPendingTool.handler({});
    const data = JSON.parse(textContent(result));

    expect(data).toBeInstanceOf(Array);

    const found1 = data.find(
      (p: any) => p.comment.id === c1.id,
    );
    expect(found1).toBeDefined();
    expect(found1.comment.status).toBe("pending");
    expect(found1.comment.content).toBe("MCP pending note comment");
    expect(found1.entityTitle).toBe("MCP Test Note");

    const found2 = data.find(
      (p: any) => p.comment.id === c2.id,
    );
    expect(found2).toBeDefined();
    expect(found2.comment.status).toBe("pending");
    expect(found2.comment.content).toBe("MCP pending task comment");
    expect(found2.entityTitle).toBe("MCP Test Task");
  });

  test("comments_get_pending excludes processed comments", async () => {
    const c = svc.createComment("note", noteId, "Will be processed via MCP");
    svc.markProcessed(c.id);

    const result = await tools.commentsGetPendingTool.handler({});
    const data = JSON.parse(textContent(result));

    expect(
      data.find((p: any) => p.comment.id === c.id),
    ).toBeUndefined();
  });

  // ── comments_mark_processed ───────────────────────────────────────

  test("comments_mark_processed marks a pending comment as processed", async () => {
    const c = svc.createComment("note", noteId, "Process via MCP tool");

    const result = await tools.commentsMarkProcessedTool.handler({ id: c.id });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(textContent(result));
    expect(data.id).toBe(c.id);
    expect(data.status).toBe("processed");
  });

  test("comments_mark_processed returns error for non-existent id", async () => {
    const fakeId = crypto.randomUUID();
    const result = await tools.commentsMarkProcessedTool.handler({
      id: fakeId,
    });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Comment not found");
  });

  test("comments_mark_processed returns error when id is missing", async () => {
    const result = await tools.commentsMarkProcessedTool.handler({});

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Missing required argument");
  });

  // ── comments_delete ───────────────────────────────────────────────

  test("comments_delete deletes a comment and returns success", async () => {
    const c = svc.createComment("note", noteId, "Delete via MCP tool");

    const result = await tools.commentsDeleteTool.handler({ id: c.id });
    expect(result.isError).toBeUndefined();

    const data = JSON.parse(textContent(result));
    expect(data).toEqual({ success: true });

    // Verify comment is gone
    const comments = svc.getComments("note", noteId);
    expect(comments.find((cc) => cc.id === c.id)).toBeUndefined();
  });

  test("comments_delete returns error for non-existent id", async () => {
    const fakeId = crypto.randomUUID();
    const result = await tools.commentsDeleteTool.handler({ id: fakeId });

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Comment not found");
  });

  test("comments_delete returns error when id is missing", async () => {
    const result = await tools.commentsDeleteTool.handler({});

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain("Missing required argument");
  });
});
