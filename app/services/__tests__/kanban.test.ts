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

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-kanban-test-"));
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

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe("Kanban service", () => {
  let kanbanService: Awaited<typeof import("../kanban")>;

  beforeAll(async () => {
    kanbanService = await import("../kanban");
  });

  afterAll(() => {
    cleanup();
  });

  // ── Board CRUD ────────────────────────────────────────────────────

  test("createBoard auto-creates 3 default columns", () => {
    const board = kanbanService.createBoard({
      name: "Test Board",
      description: "A test board",
    });

    expect(board.id).toBeDefined();
    expect(board.name).toBe("Test Board");
    expect(board.description).toBe("A test board");
    expect(board.columns).toHaveLength(3);
    expect(board.columns[0]!.name).toBe("To Do");
    expect(board.columns[0]!.position).toBe(0);
    expect(board.columns[1]!.name).toBe("In Progress");
    expect(board.columns[1]!.position).toBe(1);
    expect(board.columns[2]!.name).toBe("Done");
    expect(board.columns[2]!.position).toBe(2);
  });

  test("getBoard returns board with columns and tasks", () => {
    const board = kanbanService.createBoard({ name: "Get Board Test" });

    const fetched = kanbanService.getBoard(board.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("Get Board Test");
    expect(fetched!.columns).toHaveLength(3);
  });

  test("getBoard returns null for non-existent id", () => {
    const result = kanbanService.getBoard("nonexistent-id");
    expect(result).toBeNull();
  });

  test("listBoards returns boards with columns and task counts", () => {
    kanbanService.createBoard({ name: "List Test A" });
    kanbanService.createBoard({ name: "List Test B" });

    const boards = kanbanService.listBoards();
    // At least 4 boards total (2 from this test + 2 from previous tests)
    expect(boards.length).toBeGreaterThanOrEqual(4);

    const listBoard = boards.find((b) => b.name === "List Test A")!;
    expect(listBoard).toBeDefined();
    expect(listBoard.columns).toHaveLength(3);
    expect(listBoard.columns[0]!.name).toBe("To Do");
    expect(listBoard.columns[0]!.taskCount).toBe(0);
  });

  test("updateBoard updates name and description", () => {
    const board = kanbanService.createBoard({ name: "Original Name" });

    const updated = kanbanService.updateBoard(board.id, {
      name: "Updated Name",
      description: "Updated description",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated Name");
    expect(updated!.description).toBe("Updated description");
  });

  test("updateBoard returns null for non-existent board", () => {
    const result = kanbanService.updateBoard("nonexistent", { name: "Nope" });
    expect(result).toBeNull();
  });

  test("deleteBoard cascades to columns and tasks", () => {
    const board = kanbanService.createBoard({ name: "Delete Test" });
    const colId = board.columns[0]!.id;

    // Add a task
    kanbanService.createTask({ columnId: colId, title: "Task to delete" });

    const deleted = kanbanService.deleteBoard(board.id);
    expect(deleted).toBe(true);

    // Board is gone
    expect(kanbanService.getBoard(board.id)).toBeNull();

    // Column is gone
    expect(kanbanService.getColumn(colId)).toBeNull();

    // Task is gone
    const tasks = kanbanService.listTasks(colId);
    expect(tasks).toHaveLength(0);
  });

  test("deleteBoard returns false for non-existent board", () => {
    const result = kanbanService.deleteBoard("nonexistent-id");
    expect(result).toBe(false);
  });

  // ── Column CRUD ──────────────────────────────────────────────────

  test("createColumn adds column to board at next position", () => {
    const board = kanbanService.createBoard({ name: "Col Test" });

    const col = kanbanService.createColumn({
      boardId: board.id,
      name: "New Column",
      color: "#ff0000",
    });

    expect(col).not.toBeNull();
    expect(col!.name).toBe("New Column");
    expect(col!.color).toBe("#ff0000");
    expect(col!.position).toBe(3); // After the 3 defaults (0, 1, 2)
    expect(col!.boardId).toBe(board.id);

    const columns = kanbanService.listColumns(board.id);
    expect(columns).toHaveLength(4);
  });

  test("createColumn returns null for non-existent board", () => {
    const col = kanbanService.createColumn({
      boardId: "nonexistent",
      name: "Orphan",
    });
    expect(col).toBeNull();
  });

  test("getColumn returns column", () => {
    const board = kanbanService.createBoard({ name: "Get Col Test" });
    const col = kanbanService.getColumn(board.columns[0]!.id);
    expect(col).not.toBeNull();
    expect(col!.name).toBe("To Do");
  });

  test("updateColumn updates name and color", () => {
    const board = kanbanService.createBoard({ name: "Update Col Test" });
    const colId = board.columns[0]!.id;

    const updated = kanbanService.updateColumn(colId, {
      name: "Updated Column",
      color: "#00ff00",
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe("Updated Column");
    expect(updated!.color).toBe("#00ff00");
  });

  test("deleteColumn cascades tasks and reorders remaining columns", () => {
    const board = kanbanService.createBoard({ name: "Delete Col Test" });
    // Columns: To Do(0), In Progress(1), Done(2)

    // Delete the middle column (In Progress)
    const deleted = kanbanService.deleteColumn(board.columns[1]!.id);
    expect(deleted).toBe(true);

    const remaining = kanbanService.listColumns(board.id);
    expect(remaining).toHaveLength(2);
    expect(remaining[0]!.name).toBe("To Do");
    expect(remaining[0]!.position).toBe(0);
    expect(remaining[1]!.name).toBe("Done");
    expect(remaining[1]!.position).toBe(1);
  });

  // ── Task CRUD ────────────────────────────────────────────────────

  test("createTask creates task with auto-position and tags", () => {
    const board = kanbanService.createBoard({ name: "Task Create Test" });
    const colId = board.columns[0]!.id;

    const task = kanbanService.createTask({
      columnId: colId,
      title: "My Task",
      description: "Task description",
      tags: ["urgent", "frontend"],
    });

    expect(task).not.toBeNull();
    expect(task!.title).toBe("My Task");
    expect(task!.description).toBe("Task description");
    expect(task!.position).toBe(0); // First task
    expect(task!.tags).toEqual(["urgent", "frontend"]);
  });

  test("createTask auto-increments position", () => {
    const board = kanbanService.createBoard({ name: "Task Position Test" });
    const colId = board.columns[0]!.id;

    const t1 = kanbanService.createTask({ columnId: colId, title: "Task 1" });
    const t2 = kanbanService.createTask({ columnId: colId, title: "Task 2" });

    expect(t1!.position).toBe(0);
    expect(t2!.position).toBe(1);
  });

  test("createTask returns null for non-existent column", () => {
    const task = kanbanService.createTask({
      columnId: "nonexistent",
      title: "Orphan",
    });
    expect(task).toBeNull();
  });

  test("getTask returns task with parsed tags", () => {
    const board = kanbanService.createBoard({ name: "Get Task Test" });
    const colId = board.columns[0]!.id;

    const created = kanbanService.createTask({
      columnId: colId,
      title: "Get Task",
      tags: ["tag1"],
    });

    const fetched = kanbanService.getTask(created!.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe("Get Task");
    expect(fetched!.tags).toEqual(["tag1"]);
  });

  test("listTasks returns tasks ordered by position", () => {
    const board = kanbanService.createBoard({ name: "List Tasks Test" });
    const colId = board.columns[0]!.id;

    kanbanService.createTask({ columnId: colId, title: "Task B" });
    kanbanService.createTask({ columnId: colId, title: "Task A" });

    const tasks = kanbanService.listTasks(colId);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.title).toBe("Task B"); // Created first, position 0
    expect(tasks[1]!.title).toBe("Task A"); // Created second, position 1
  });

  test("updateTask updates fields and preserves others", () => {
    const board = kanbanService.createBoard({ name: "Update Task Test" });
    const colId = board.columns[0]!.id;

    const task = kanbanService.createTask({
      columnId: colId,
      title: "Original",
      description: "Desc",
      tags: ["a"],
    });

    const updated = kanbanService.updateTask(task!.id, {
      title: "Updated Title",
      tags: ["b"],
    });

    expect(updated!.title).toBe("Updated Title");
    expect(updated!.description).toBe("Desc"); // Preserved
    expect(updated!.tags).toEqual(["b"]);
  });

  test("deleteTask reorders remaining tasks", () => {
    const board = kanbanService.createBoard({ name: "Delete Task Test" });
    const colId = board.columns[0]!.id;

    kanbanService.createTask({ columnId: colId, title: "Task 1" });
    const t2 = kanbanService.createTask({ columnId: colId, title: "Task 2" });
    kanbanService.createTask({ columnId: colId, title: "Task 3" });

    // Delete middle task (t2, position 1)
    const deleted = kanbanService.deleteTask(t2!.id);
    expect(deleted).toBe(true);

    const remaining = kanbanService.listTasks(colId);
    expect(remaining).toHaveLength(2);
    expect(remaining[0]!.title).toBe("Task 1");
    expect(remaining[0]!.position).toBe(0);
    expect(remaining[1]!.title).toBe("Task 3");
    expect(remaining[1]!.position).toBe(1);
  });

  // ── Move / Reorder ───────────────────────────────────────────────

  test("moveTask moves task between columns and adjusts positions", () => {
    const board = kanbanService.createBoard({ name: "Move Test" });
    const srcColId = board.columns[0]!.id; // To Do
    const dstColId = board.columns[1]!.id; // In Progress

    const taskA = kanbanService.createTask({ columnId: srcColId, title: "Task A" });
    kanbanService.createTask({ columnId: srcColId, title: "Task B" });

    const moved = kanbanService.moveTask(
      taskA!.id,
      dstColId,
    );

    expect(moved).not.toBeNull();
    expect(moved!.columnId).toBe(dstColId);

    // Source column should have 1 task left
    const srcTasks = kanbanService.listTasks(srcColId);
    expect(srcTasks).toHaveLength(1);
    expect(srcTasks[0]!.title).toBe("Task B");
    expect(srcTasks[0]!.position).toBe(0); // Re-indexed

    // Destination column should have 1 task (the moved one)
    const dstTasks = kanbanService.listTasks(dstColId);
    expect(dstTasks).toHaveLength(1);
    expect(dstTasks[0]!.title).toBe("Task A");
  });

  test("moveTask reorders within same column (move down)", () => {
    const board = kanbanService.createBoard({ name: "Reorder Same Col" });
    const colId = board.columns[0]!.id;

    const t1 = kanbanService.createTask({ columnId: colId, title: "Pos 0" });
    kanbanService.createTask({ columnId: colId, title: "Pos 1" });
    kanbanService.createTask({ columnId: colId, title: "Pos 2" });

    // Move t1 (pos 0) to position 2
    kanbanService.moveTask(t1!.id, colId, 2);

    const tasks = kanbanService.listTasks(colId);
    expect(tasks[0]!.title).toBe("Pos 1");
    expect(tasks[0]!.position).toBe(0);
    expect(tasks[1]!.title).toBe("Pos 2");
    expect(tasks[1]!.position).toBe(1);
    expect(tasks[2]!.title).toBe("Pos 0");
    expect(tasks[2]!.position).toBe(2);
  });

  test("moveTask reorders within same column (move up)", () => {
    const board = kanbanService.createBoard({ name: "Reorder Up" });
    const colId = board.columns[0]!.id;

    kanbanService.createTask({ columnId: colId, title: "Pos 0" });
    const t2 = kanbanService.createTask({ columnId: colId, title: "Pos 1" });

    // Move t2 (pos 1) to position 0
    kanbanService.moveTask(t2!.id, colId, 0);

    const tasks = kanbanService.listTasks(colId);
    expect(tasks[0]!.title).toBe("Pos 1");
    expect(tasks[0]!.position).toBe(0);
    expect(tasks[1]!.title).toBe("Pos 0");
    expect(tasks[1]!.position).toBe(1);
  });

  test("moveTask appends when targetPosition is undefined", () => {
    const board = kanbanService.createBoard({ name: "Move Append" });
    const colId = board.columns[0]!.id;

    const t1 = kanbanService.createTask({ columnId: colId, title: "A" });
    kanbanService.createTask({ columnId: colId, title: "B" });

    // Move t1 to same column without position → stays
    const result = kanbanService.moveTask(t1!.id, colId);
    expect(result!.position).toBe(0); // Already at position 0, same column, no change
  });

  test("moveTask returns null for non-existent task", () => {
    const result = kanbanService.moveTask("nonexistent", "somecol");
    expect(result).toBeNull();
  });
});
