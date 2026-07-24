import type { Context } from "hono";
import { Hono } from "hono";
import {
  createComment,
  getComments,
  markProcessed,
  deleteComment,
  getPendingComments,
} from "../services/comments";

// ---------------------------------------------------------------------------
// Router — mounted at /api by the parent
// ---------------------------------------------------------------------------

export const commentRouter = new Hono();

// ── GET /api/notes/:noteId/comments ───────────────────────────────────────

commentRouter.get("/notes/:noteId/comments", async (c: Context) => {
  const noteId = c.req.param("noteId") as string;
  const result = getComments("note", noteId);
  return c.json({ data: result });
});

// ── POST /api/notes/:noteId/comments ──────────────────────────────────────

commentRouter.post("/notes/:noteId/comments", async (c: Context) => {
  const noteId = c.req.param("noteId") as string;

  let content = "";
  try {
    const body = await c.req.json<{ content?: string }>();
    content = body.content ?? "";
  } catch {
    // body was not valid JSON — content stays ""
  }

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return c.json({ error: "content is required" }, 400);
  }

  try {
    const comment = createComment("note", noteId, content.trim());
    return c.json({ data: comment }, 201);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create comment";
    return c.json({ error: message }, 404);
  }
});

// ── PATCH /api/comments/:id/process ────────────────────────────────────────

commentRouter.patch("/comments/:id/process", async (c: Context) => {
  const id = c.req.param("id") as string;
  const updated = markProcessed(id);

  if (!updated) {
    return c.json({ error: "Comment not found" }, 404);
  }

  return c.json({ data: updated });
});

// ── DELETE /api/comments/:id ──────────────────────────────────────────────

commentRouter.delete("/comments/:id", async (c: Context) => {
  const id = c.req.param("id") as string;
  const deleted = deleteComment(id);

  if (!deleted) {
    return c.json({ error: "Comment not found" }, 404);
  }

  return c.json({ success: true });
});

// ── GET /api/comments/pending ─────────────────────────────────────────────

commentRouter.get("/comments/pending", async (c: Context) => {
  const result = getPendingComments();
  return c.json({ data: result });
});
