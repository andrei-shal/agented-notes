/**
 * Notes HTTP API — validation layer only; delegates to the notes service.
 *
 * All routes are protected by the auth middleware (bearer token required).
 */
import { Hono } from "hono";
import { z } from "zod";
import {
  createNote,
  getNote,
  listNotes,
  updateNote,
  deleteNote,
  NotFoundError,
  type NoteListFilters,
} from "../services/notes";

// ── Zod schemas ─────────────────────────────────────────────────────────────

const createNoteSchema = z.object({
  title: z.string().min(1, "Title is required"),
  content: z.string().default(""),
});

const updateNoteSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
});

const listQuerySchema = z.object({
  tag: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// ── Router ──────────────────────────────────────────────────────────────────

export const notesRouter = new Hono();

// ── GET /api/notes — list ─────────────────────────────────────────────────

notesRouter.get("/", async (c) => {
  const query = listQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json(
      { error: "Invalid query parameters", details: query.error.flatten() },
      400,
    );
  }

  const filters: NoteListFilters = {
    tag: query.data.tag,
    search: query.data.search,
    limit: query.data.limit,
    offset: query.data.offset,
  };

  const result = listNotes(filters);
  return c.json(result);
});

// ── GET /api/notes/:id — single note with comments ───────────────────────

notesRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Missing note id" }, 400);
  }

  const note = getNote(id);
  if (!note) {
    return c.json({ error: "Note not found" }, 404);
  }

  return c.json(note);
});

// ── POST /api/notes — create ─────────────────────────────────────────────

notesRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      400,
    );
  }

  const note = createNote(parsed.data.title, parsed.data.content);
  return c.json(note, 201);
});

// ── PUT /api/notes/:id — update ──────────────────────────────────────────

notesRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Missing note id" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      400,
    );
  }

  try {
    const note = updateNote(id, parsed.data);
    return c.json(note);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    throw err;
  }
});

// ── DELETE /api/notes/:id — delete ───────────────────────────────────────

notesRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ error: "Missing note id" }, 400);
  }

  try {
    deleteNote(id);
    return c.json({ message: "Note deleted" });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    throw err;
  }
});
