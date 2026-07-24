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

// ── Test database setup ─────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-todos-mcp-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

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

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ── Helper: parse JSON text from an MCP tool result ─────────────────

function parseResult(result: { content: [{ type: string; text: string }] }): unknown {
  return JSON.parse(result.content[0]!.text);
}

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe("MCP todos tools", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let kanban: any;
  let handlers: Record<string, (args: Record<string, unknown>) => Promise<{ content: [{ type: string; text: string }] }>>;

  beforeAll(async () => {
    kanban = await import("../../services/kanban");
    const { tools } = await import("../tools/index");

    handlers = {};
    for (const t of tools) {
      handlers[t.definition.name] = (args: Record<string, unknown>) =>
        t.handler(args) as Promise<{ content: [{ type: string; text: string }] }>;
    }
  });

  afterAll(() => {
    cleanup();
  });

  // ── Prerequisites: seed a board + column for tests that need them ──

  let boardId: string;
  let columnId: string;

  beforeAll(() => {
    const board = kanban.createBoard({ name: "MCP Test Board" });
    boardId = board.id;
    columnId = board.columns[0]!.id;
  });

  // ── kanban_boards_list ────────────────────────────────────────────

  test("kanban_boards_list returns boards with MCP envelope", async () => {
    const result = await handlers["kanban_boards_list"]!({});
    expect(result).toHaveProperty("content");
    expect(result.content[0]!.type).toBe("text");

    const data = parseResult(result) as Array<Record<string, unknown>>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);

    const board = data.find((b) => b["id"] === boardId);
    expect(board).toBeDefined();
    expect(board!["name"]).toBe("MCP Test Board");
    expect(board!["columns"]).toBeDefined();
  });

  // ── kanban_columns_list ───────────────────────────────────────────

  test("kanban_columns_list returns columns for a board", async () => {
    const result = await handlers["kanban_columns_list"]!({ board_id: boardId });
    const data = parseResult(result) as Array<Record<string, unknown>>;

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(3);
    expect(data[0]!["name"]).toBe("To Do");
    expect(data[0]!["boardId"]).toBe(boardId);
  });

  test("kanban_columns_list returns empty array for unknown board", async () => {
    const result = await handlers["kanban_columns_list"]!({ board_id: "nonexistent" });
    const data = parseResult(result);
    expect(data).toEqual([]);
  });

  // ── kanban_tasks_list ─────────────────────────────────────────────

  test("kanban_tasks_list returns tasks for a column", async () => {
    const result = await handlers["kanban_tasks_list"]!({ column_id: columnId });
    const data = parseResult(result);
    expect(data).toEqual([]);
  });

  test("kanban_tasks_list returns empty array for unknown column", async () => {
    const result = await handlers["kanban_tasks_list"]!({ column_id: "nonexistent" });
    const data = parseResult(result);
    expect(data).toEqual([]);
  });

  // ── kanban_task_create ────────────────────────────────────────────

  test("kanban_task_create creates a task and returns it", async () => {
    const result = await handlers["kanban_task_create"]!({
      title: "MCP Created Task",
      description: "Created via tool",
      column_id: columnId,
      tags: ["mcp", "test"],
    });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data).not.toBeNull();
    expect(data!["title"]).toBe("MCP Created Task");
    expect(data!["description"]).toBe("Created via tool");
    expect(data!["columnId"]).toBe(columnId);
    expect(data!["tags"]).toEqual(["mcp", "test"]);
    expect(data!["position"]).toBe(0);
  });

  test("kanban_task_create returns null for bad column_id", async () => {
    const result = await handlers["kanban_task_create"]!({
      title: "Orphan",
      column_id: "nonexistent",
    });
    const data = parseResult(result);
    expect(data).toBeNull();
  });

  test("kanban_task_create returns null when required args are missing", async () => {
    const result = await handlers["kanban_task_create"]!({});
    const data = parseResult(result);
    expect(data).toBeNull();
  });

  // ── kanban_task_update ────────────────────────────────────────────

  test("kanban_task_update updates task fields", async () => {
    const task = kanban.createTask({ columnId, title: "Before Update" });

    const result = await handlers["kanban_task_update"]!({
      task_id: task!.id,
      title: "After Update",
      tags: ["updated"],
    });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data).not.toBeNull();
    expect(data!["title"]).toBe("After Update");
    expect(data!["tags"]).toEqual(["updated"]);
    expect(data!["description"]).toBeNull();
  });

  test("kanban_task_update clears description when null is passed", async () => {
    const task = kanban.createTask({
      columnId,
      title: "Clear Desc",
      description: "Will be cleared",
    });

    const result = await handlers["kanban_task_update"]!({
      task_id: task!.id,
      description: null,
    });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data!["description"]).toBeNull();
  });

  test("kanban_task_update returns null for unknown task", async () => {
    const result = await handlers["kanban_task_update"]!({
      task_id: "nonexistent",
    });
    const data = parseResult(result);
    expect(data).toBeNull();
  });

  // ── kanban_task_move ──────────────────────────────────────────────

  test("kanban_task_move moves task between columns", async () => {
    const dstCol = kanban.listColumns(boardId)[1]!.id;

    const task = kanban.createTask({ columnId, title: "Move Me" });

    const result = await handlers["kanban_task_move"]!({
      task_id: task!.id,
      target_column_id: dstCol,
    });
    const data = parseResult(result) as Record<string, unknown>;

    expect(data).not.toBeNull();
    expect(data!["columnId"]).toBe(dstCol);
  });

  test("kanban_task_move returns null for unknown task", async () => {
    const result = await handlers["kanban_task_move"]!({
      task_id: "nonexistent",
      target_column_id: columnId,
    });
    const data = parseResult(result);
    expect(data).toBeNull();
  });

  test("kanban_task_move returns null for unknown target column", async () => {
    const task = kanban.createTask({ columnId, title: "Lost" });

    const result = await handlers["kanban_task_move"]!({
      task_id: task!.id,
      target_column_id: "nonexistent-column",
    });
    const data = parseResult(result);
    expect(data).toBeNull();
  });

  // ── kanban_task_delete ────────────────────────────────────────────

  test("kanban_task_delete deletes a task", async () => {
    const task = kanban.createTask({ columnId, title: "Delete Me" });

    const result = await handlers["kanban_task_delete"]!({
      task_id: task!.id,
    });
    const data = parseResult(result);
    expect(data).toBe(true);

    // Verify it's gone
    const tasks = kanban.listTasks(columnId);
    expect(tasks.find((t: Record<string, unknown>) => t["id"] === task!.id)).toBeUndefined();
  });

  test("kanban_task_delete returns false for unknown task", async () => {
    const result = await handlers["kanban_task_delete"]!({
      task_id: "nonexistent",
    });
    const data = parseResult(result);
    expect(data).toBe(false);
  });
});
