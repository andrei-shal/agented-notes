import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/db";
import { kanbanBoards, kanbanColumns, kanbanTasks } from "../db/schema";
import { syncTaskFts } from "../db/fts5";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateBoardInput {
  name: string;
  description?: string | null;
}

export interface UpdateBoardInput {
  name?: string;
  description?: string | null;
}

export interface CreateColumnInput {
  boardId: string;
  name: string;
  color?: string | null;
}

export interface UpdateColumnInput {
  name?: string;
  color?: string | null;
}

export interface CreateTaskInput {
  columnId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  tags?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  dueDate?: string | null;
  tags?: string[];
}

export interface MoveTaskInput {
  targetColumnId: string;
  targetPosition?: number;
}

// ---------------------------------------------------------------------------
// Return types (shapes returned to callers)
// ---------------------------------------------------------------------------

export interface BoardWithColumns {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  columns: ColumnWithTasks[];
}

export interface ColumnWithTasks {
  id: string;
  boardId: string;
  name: string;
  position: number;
  color: string | null;
  createdAt: string;
  tasks: TaskItem[];
}

export interface BoardListItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  columns: Array<{
    id: string;
    name: string;
    position: number;
    color: string | null;
    taskCount: number;
  }>;
}

export interface TaskItem {
  id: string;
  columnId: string;
  title: string;
  description: string | null;
  position: number;
  dueDate: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTags(raw: string | null): string[] {
  try {
    return JSON.parse(raw ?? "[]") as string[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Board operations
// ---------------------------------------------------------------------------

export function createBoard(input: CreateBoardInput): BoardWithColumns {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(kanbanBoards)
    .values({ id, name: input.name, description: input.description ?? null, createdAt: now })
    .run();

  // Auto-create 3 default columns
  const defaultColumns = [
    { id: crypto.randomUUID(), boardId: id, name: "To Do", position: 0, color: null, createdAt: now },
    { id: crypto.randomUUID(), boardId: id, name: "In Progress", position: 1, color: null, createdAt: now },
    { id: crypto.randomUUID(), boardId: id, name: "Done", position: 2, color: null, createdAt: now },
  ];

  for (const col of defaultColumns) {
    db.insert(kanbanColumns).values(col).run();
  }

  return {
    id,
    name: input.name,
    description: input.description ?? null,
    createdAt: now,
    columns: defaultColumns.map((c) => ({ ...c, tasks: [] })),
  };
}

export function getBoard(id: string): BoardWithColumns | null {
  const board = db
    .select()
    .from(kanbanBoards)
    .where(eq(kanbanBoards.id, id))
    .get();

  if (!board) return null;

  const columns = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.boardId, id))
    .orderBy(asc(kanbanColumns.position))
    .all();

  const columnIds = columns.map((c) => c.id);
  const rawTasks =
    columnIds.length > 0
      ? db
          .select()
          .from(kanbanTasks)
          .where(inArray(kanbanTasks.columnId, columnIds))
          .orderBy(asc(kanbanTasks.position))
          .all()
      : [];

  return {
    id: board.id,
    name: board.name,
    description: board.description,
    createdAt: board.createdAt!,
    columns: columns.map((col) => ({
      id: col.id,
      boardId: col.boardId,
      name: col.name,
      position: col.position,
      color: col.color,
      createdAt: col.createdAt!,
      tasks: rawTasks
        .filter((t) => t.columnId === col.id)
        .map((t) => ({
          ...t,
          tags: parseTags(t.tags ?? "[]"),
          createdAt: t.createdAt!,
          updatedAt: t.updatedAt!,
        })),
    })),
  };
}

export function listBoards(): BoardListItem[] {
  const boards = db.select().from(kanbanBoards).orderBy(asc(kanbanBoards.createdAt)).all();

  if (boards.length === 0) return [];

  const boardIds = boards.map((b) => b.id);

  const columns = db
    .select()
    .from(kanbanColumns)
    .where(inArray(kanbanColumns.boardId, boardIds))
    .orderBy(asc(kanbanColumns.position))
    .all();

  const columnIds = columns.map((c) => c.id);

  const taskCounts: Array<{ columnId: string; count: number }> =
    columnIds.length > 0
      ? db
          .select({
            columnId: kanbanTasks.columnId,
            count: sql<number>`COUNT(*)`,
          })
          .from(kanbanTasks)
          .where(inArray(kanbanTasks.columnId, columnIds))
          .groupBy(kanbanTasks.columnId)
          .all()
      : [];

  const taskCountMap = new Map<string, number>();
  for (const row of taskCounts) {
    taskCountMap.set(row.columnId, row.count);
  }

  const columnsByBoard = new Map<string, typeof columns>();
  for (const col of columns) {
    const list = columnsByBoard.get(col.boardId) ?? [];
    list.push(col);
    columnsByBoard.set(col.boardId, list);
  }

  return boards.map((board) => {
    const boardColumns = columnsByBoard.get(board.id) ?? [];
    return {
      id: board.id,
      name: board.name,
      description: board.description,
      createdAt: board.createdAt!,
      columns: boardColumns.map((col) => ({
        id: col.id,
        name: col.name,
        position: col.position,
        color: col.color,
        taskCount: taskCountMap.get(col.id) ?? 0,
      })),
    };
  });
}

export function updateBoard(id: string, input: UpdateBoardInput): BoardWithColumns | null {
  const existing = db
    .select()
    .from(kanbanBoards)
    .where(eq(kanbanBoards.id, id))
    .get();

  if (!existing) return null;

  db.update(kanbanBoards)
    .set({
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description : existing.description,
    })
    .where(eq(kanbanBoards.id, id))
    .run();

  return getBoard(id)!;
}

export function deleteBoard(id: string): boolean {
  const existing = db
    .select()
    .from(kanbanBoards)
    .where(eq(kanbanBoards.id, id))
    .get();

  if (!existing) return false;

  // Cascade: delete all tasks in board's columns, then columns, then board
  const columns = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.boardId, id))
    .all();

  const columnIds = columns.map((c) => c.id);

  if (columnIds.length > 0) {
    db.delete(kanbanTasks)
      .where(inArray(kanbanTasks.columnId, columnIds))
      .run();
    db.delete(kanbanColumns)
      .where(inArray(kanbanColumns.boardId, [id]))
      .run();
  }

  db.delete(kanbanBoards).where(eq(kanbanBoards.id, id)).run();

  return true;
}

// ---------------------------------------------------------------------------
// Column operations
// ---------------------------------------------------------------------------

export function createColumn(input: CreateColumnInput) {
  const board = db
    .select()
    .from(kanbanBoards)
    .where(eq(kanbanBoards.id, input.boardId))
    .get();

  if (!board) return null;

  const maxPos = db
    .select({ max: sql<number>`COALESCE(MAX(${kanbanColumns.position}), -1)` })
    .from(kanbanColumns)
    .where(eq(kanbanColumns.boardId, input.boardId))
    .get();

  const position = maxPos!.max + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(kanbanColumns)
    .values({
      id,
      boardId: input.boardId,
      name: input.name,
      position,
      color: input.color ?? null,
      createdAt: now,
    })
    .run();

  return {
    id,
    boardId: input.boardId,
    name: input.name,
    position,
    color: input.color ?? null,
    createdAt: now,
  };
}

export function getColumn(id: string) {
  const col = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.id, id))
    .get();

  if (!col) return null;

  return {
    ...col,
    createdAt: col.createdAt!,
  };
}

export function listColumns(boardId: string) {
  const columns = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.boardId, boardId))
    .orderBy(asc(kanbanColumns.position))
    .all();

  return columns.map((c) => ({ ...c, createdAt: c.createdAt! }));
}

export function updateColumn(id: string, input: UpdateColumnInput) {
  const existing = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.id, id))
    .get();

  if (!existing) return null;

  db.update(kanbanColumns)
    .set({
      name: input.name ?? existing.name,
      color: input.color !== undefined ? input.color : existing.color,
    })
    .where(eq(kanbanColumns.id, id))
    .run();

  return getColumn(id)!;
}

export function deleteColumn(id: string): boolean {
  const existing = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.id, id))
    .get();

  if (!existing) return false;

  const boardId = existing.boardId;
  const deletedPosition = existing.position;

  // Cascade: delete all tasks in this column
  db.delete(kanbanTasks).where(eq(kanbanTasks.columnId, id)).run();

  // Delete the column
  db.delete(kanbanColumns).where(eq(kanbanColumns.id, id)).run();

  // Reorder: shift positions of remaining columns after the deleted one
  db.update(kanbanColumns)
    .set({ position: sql`${kanbanColumns.position} - 1` })
    .where(and(eq(kanbanColumns.boardId, boardId), sql`${kanbanColumns.position} > ${deletedPosition}`))
    .run();

  return true;
}

// ---------------------------------------------------------------------------
// Task operations
// ---------------------------------------------------------------------------

export function createTask(input: CreateTaskInput) {
  const column = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.id, input.columnId))
    .get();

  if (!column) return null;

  const maxPos = db
    .select({ max: sql<number>`COALESCE(MAX(${kanbanTasks.position}), -1)` })
    .from(kanbanTasks)
    .where(eq(kanbanTasks.columnId, input.columnId))
    .get();

  const position = maxPos!.max + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.insert(kanbanTasks)
    .values({
      id,
      columnId: input.columnId,
      title: input.title,
      description: input.description ?? null,
      position,
      dueDate: input.dueDate ?? null,
      tags: JSON.stringify(input.tags ?? []),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  syncTaskFts(id, "upsert");

  return {
    id,
    columnId: input.columnId,
    title: input.title,
    description: input.description ?? null,
    position,
    dueDate: input.dueDate ?? null,
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function getTask(id: string) {
  const task = db
    .select()
    .from(kanbanTasks)
    .where(eq(kanbanTasks.id, id))
    .get();

  if (!task) return null;

  return {
    ...task,
    tags: parseTags(task.tags),
  };
}

export function listTasks(columnId: string) {
  const tasks = db
    .select()
    .from(kanbanTasks)
    .where(eq(kanbanTasks.columnId, columnId))
    .orderBy(asc(kanbanTasks.position))
    .all();

  return tasks.map((t) => ({
    ...t,
    tags: parseTags(t.tags),
  }));
}

export function updateTask(id: string, input: UpdateTaskInput) {
  const existing = db
    .select()
    .from(kanbanTasks)
    .where(eq(kanbanTasks.id, id))
    .get();

  if (!existing) return null;

  const now = new Date().toISOString();

  const updates: Record<string, unknown> = { updatedAt: now };

  if (input.title !== undefined) updates["title"] = input.title;
  if (input.description !== undefined) updates["description"] = input.description;
  if (input.dueDate !== undefined) updates["dueDate"] = input.dueDate;
  if (input.tags !== undefined) updates["tags"] = JSON.stringify(input.tags);

  db.update(kanbanTasks)
    .set(updates)
    .where(eq(kanbanTasks.id, id))
    .run();

  syncTaskFts(id, "upsert");

  return getTask(id)!;
}

export function deleteTask(id: string): boolean {
  const existing = db
    .select({ rowid: sql<number>`rowid`, columnId: kanbanTasks.columnId, position: kanbanTasks.position })
    .from(kanbanTasks)
    .where(eq(kanbanTasks.id, id))
    .get();

  if (!existing) return false;

  const { rowid, columnId, position: deletedPosition } = existing;

  db.delete(kanbanTasks).where(eq(kanbanTasks.id, id)).run();

  syncTaskFts(id, "delete", rowid);

  // Reorder: shift positions of remaining tasks in the same column
  db.update(kanbanTasks)
    .set({ position: sql`${kanbanTasks.position} - 1` })
    .where(and(eq(kanbanTasks.columnId, columnId), sql`${kanbanTasks.position} > ${deletedPosition}`))
    .run();

  return true;
}

// ---------------------------------------------------------------------------
// Move task between columns / reorder within column
// ---------------------------------------------------------------------------

export function moveTask(taskId: string, targetColumnId: string, targetPosition?: number) {
  const task = db
    .select()
    .from(kanbanTasks)
    .where(eq(kanbanTasks.id, taskId))
    .get();

  if (!task) return null;

  const targetColumn = db
    .select()
    .from(kanbanColumns)
    .where(eq(kanbanColumns.id, targetColumnId))
    .get();

  if (!targetColumn) return null;

  const sourceColumnId = task.columnId;
  const sourcePosition = task.position;

  if (sourceColumnId === targetColumnId) {
    // Reordering within the same column
    const maxPos = db
      .select({ max: sql<number>`COALESCE(MAX(${kanbanTasks.position}), 0)` })
      .from(kanbanTasks)
      .where(eq(kanbanTasks.columnId, sourceColumnId))
      .get();

    const effectiveTarget = targetPosition !== undefined
      ? Math.min(targetPosition, maxPos!.max)
      : sourcePosition;

    if (effectiveTarget === sourcePosition) {
      return getTask(taskId)!;
    }

    if (effectiveTarget > sourcePosition) {
      // Shift items between source+1 and effectiveTarget down by 1
      db.update(kanbanTasks)
        .set({ position: sql`${kanbanTasks.position} - 1` })
        .where(
          and(
            eq(kanbanTasks.columnId, sourceColumnId),
            sql`${kanbanTasks.position} > ${sourcePosition}`,
            sql`${kanbanTasks.position} <= ${effectiveTarget}`,
          ),
        )
        .run();
    } else {
      // Shift items between effectiveTarget and source-1 up by 1
      db.update(kanbanTasks)
        .set({ position: sql`${kanbanTasks.position} + 1` })
        .where(
          and(
            eq(kanbanTasks.columnId, sourceColumnId),
            sql`${kanbanTasks.position} >= ${effectiveTarget}`,
            sql`${kanbanTasks.position} < ${sourcePosition}`,
          ),
        )
        .run();
    }

    db.update(kanbanTasks)
      .set({ position: effectiveTarget })
      .where(eq(kanbanTasks.id, taskId))
      .run();
  } else {
    // Moving to a different column

    // 1. Close the gap in the source column
    db.update(kanbanTasks)
      .set({ position: sql`${kanbanTasks.position} - 1` })
      .where(
        and(
          eq(kanbanTasks.columnId, sourceColumnId),
          sql`${kanbanTasks.position} > ${sourcePosition}`,
        ),
      )
      .run();

    // 2. Determine target position
    const maxPos = db
      .select({ max: sql<number>`COALESCE(MAX(${kanbanTasks.position}), -1)` })
      .from(kanbanTasks)
      .where(eq(kanbanTasks.columnId, targetColumnId))
      .get();

    const effectiveTarget = targetPosition !== undefined
      ? Math.min(targetPosition, maxPos!.max + 1)
      : maxPos!.max + 1;

    // 3. Make room in the target column
    db.update(kanbanTasks)
      .set({ position: sql`${kanbanTasks.position} + 1` })
      .where(
        and(
          eq(kanbanTasks.columnId, targetColumnId),
          sql`${kanbanTasks.position} >= ${effectiveTarget}`,
        ),
      )
      .run();

    // 4. Move the task
    db.update(kanbanTasks)
      .set({
        columnId: targetColumnId,
        position: effectiveTarget,
      })
      .where(eq(kanbanTasks.id, taskId))
      .run();
  }

  return getTask(taskId)!;
}
