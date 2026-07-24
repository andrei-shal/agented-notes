import { Hono } from "hono";
import * as kanbanService from "../services/kanban";

export const kanbanRouter = new Hono();

// ── GET /api/kanban/boards ──────────────────────────────────────────

kanbanRouter.get("/boards", (c) => {
  const boards = kanbanService.listBoards();
  return c.json(boards);
});

// ── POST /api/kanban/boards ─────────────────────────────────────────

kanbanRouter.post("/boards", async (c) => {
  const body = await c.req.json<{ name?: string; description?: string | null }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  const board = kanbanService.createBoard({
    name: body.name.trim(),
    description: body.description ?? null,
  });

  return c.json(board, 201);
});

// ── GET /api/kanban/boards/:id ──────────────────────────────────────

kanbanRouter.get("/boards/:id", (c) => {
  const id = c.req.param("id");
  const board = kanbanService.getBoard(id);

  if (!board) {
    return c.json({ error: "Board not found" }, 404);
  }

  return c.json(board);
});

// ── PUT /api/kanban/boards/:id ──────────────────────────────────────

kanbanRouter.put("/boards/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; description?: string | null }>();

  if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length === 0)) {
    return c.json({ error: "name must be a non-empty string" }, 400);
  }

  const board = kanbanService.updateBoard(id, {
    name: body.name?.trim(),
    description: body.description,
  });

  if (!board) {
    return c.json({ error: "Board not found" }, 404);
  }

  return c.json(board);
});

// ── DELETE /api/kanban/boards/:id ───────────────────────────────────

kanbanRouter.delete("/boards/:id", (c) => {
  const id = c.req.param("id");
  const deleted = kanbanService.deleteBoard(id);

  if (!deleted) {
    return c.json({ error: "Board not found" }, 404);
  }

  return c.json({ message: "Board deleted" });
});

// ── POST /api/kanban/boards/:boardId/columns ────────────────────────

kanbanRouter.post("/boards/:boardId/columns", async (c) => {
  const boardId = c.req.param("boardId");
  const body = await c.req.json<{ name?: string; color?: string | null }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  const column = kanbanService.createColumn({
    boardId,
    name: body.name.trim(),
    color: body.color ?? null,
  });

  if (!column) {
    return c.json({ error: "Board not found" }, 404);
  }

  return c.json(column, 201);
});

// ── PUT /api/kanban/columns/:id ─────────────────────────────────────

kanbanRouter.put("/columns/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ name?: string; color?: string | null }>();

  if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length === 0)) {
    return c.json({ error: "name must be a non-empty string" }, 400);
  }

  const column = kanbanService.updateColumn(id, {
    name: body.name?.trim(),
    color: body.color,
  });

  if (!column) {
    return c.json({ error: "Column not found" }, 404);
  }

  return c.json(column);
});

// ── DELETE /api/kanban/columns/:id ──────────────────────────────────

kanbanRouter.delete("/columns/:id", (c) => {
  const id = c.req.param("id");
  const deleted = kanbanService.deleteColumn(id);

  if (!deleted) {
    return c.json({ error: "Column not found" }, 404);
  }

  return c.json({ message: "Column deleted" });
});

// ── GET /api/kanban/boards/:boardId/columns/:columnId/tasks ────────

kanbanRouter.get("/boards/:boardId/columns/:columnId/tasks", (c) => {
  const columnId = c.req.param("columnId");
  const tasks = kanbanService.listTasks(columnId);

  return c.json(tasks);
});

// ── POST /api/kanban/boards/:boardId/columns/:columnId/tasks ───────

kanbanRouter.post("/boards/:boardId/columns/:columnId/tasks", async (c) => {
  const columnId = c.req.param("columnId");
  const body = await c.req.json<{
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    tags?: string[];
  }>();

  if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
    return c.json({ error: "title is required" }, 400);
  }

  const task = kanbanService.createTask({
    columnId,
    title: body.title.trim(),
    description: body.description ?? null,
    dueDate: body.dueDate ?? null,
    tags: body.tags ?? [],
  });

  if (!task) {
    return c.json({ error: "Column not found" }, 404);
  }

  return c.json(task, 201);
});

// ── PATCH /api/kanban/tasks/:id/move ────────────────────────────────

kanbanRouter.patch("/tasks/:id/move", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    targetColumnId?: string;
    targetPosition?: number;
  }>();

  if (!body.targetColumnId || typeof body.targetColumnId !== "string") {
    return c.json({ error: "targetColumnId is required" }, 400);
  }

  const task = kanbanService.moveTask(
    id,
    body.targetColumnId,
    body.targetPosition,
  );

  if (!task) {
    return c.json({ error: "Task or target column not found" }, 404);
  }

  return c.json(task);
});

// ── PUT /api/kanban/tasks/:id ───────────────────────────────────────

kanbanRouter.put("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    description?: string | null;
    dueDate?: string | null;
    tags?: string[];
  }>();

  if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length === 0)) {
    return c.json({ error: "title must be a non-empty string" }, 400);
  }

  const task = kanbanService.updateTask(id, {
    title: body.title?.trim(),
    description: body.description,
    dueDate: body.dueDate,
    tags: body.tags,
  });

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json(task);
});

// ── DELETE /api/kanban/tasks/:id ────────────────────────────────────

kanbanRouter.delete("/tasks/:id", (c) => {
  const id = c.req.param("id");
  const deleted = kanbanService.deleteTask(id);

  if (!deleted) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json({ message: "Task deleted" });
});
