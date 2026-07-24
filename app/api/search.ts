import { Hono } from "hono";
import { getDb } from "../db/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an FTS5 query string.
 *
 * Escapes interior double quotes to prevent syntax errors while allowing
 * native FTS5 syntax (AND, OR, NOT, prefix *, phrase "", etc.).
 */
function sanitizeFts5(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "";
  // FTS5 escapes " by doubling it inside the query
  return trimmed.replace(/"/g, '""');
}

const VALID_TYPES = new Set(["notes", "tasks", "all"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const searchRouter = new Hono();

// ── GET /api/search?q=xxx&type=notes|tasks|all ──────────────────────────

searchRouter.get("/", async (c) => {
  const q = c.req.query("q");
  const rawType = c.req.query("type") ?? "all";
  const type = rawType.toLowerCase();

  if (!q || !q.trim()) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  if (!VALID_TYPES.has(type)) {
    return c.json(
      { error: `Invalid type "${rawType}". Must be "notes", "tasks", or "all"` },
      400,
    );
  }

  const query = sanitizeFts5(q.trim());
  const sqlite = getDb().$client;

  const results: Array<Record<string, unknown>> = [];

  // ── Search notes ──────────────────────────────────────────────────

  if (type === "all" || type === "notes") {
    try {
      const rows = sqlite
        .query(
          `SELECT n.id, n.title, n.content, n.created_at, n.updated_at, notes_fts.rank
           FROM notes_fts
           JOIN notes n ON n.rowid = notes_fts.rowid
           WHERE notes_fts MATCH ?
           ORDER BY notes_fts.rank
           LIMIT 20`,
        )
        .all(query) as Array<Record<string, unknown>>;

      for (const row of rows) {
        results.push({ ...row, type: "note" });
      }
    } catch {
      // FTS5 syntax error — skip notes
    }
  }

  // ── Search tasks ──────────────────────────────────────────────────

  if (type === "all" || type === "tasks") {
    try {
      const rows = sqlite
        .query(
          `SELECT t.id, t.title, t.description, t.created_at, t.updated_at, tasks_fts.rank
           FROM tasks_fts
           JOIN kanban_tasks t ON t.rowid = tasks_fts.rowid
           WHERE tasks_fts MATCH ?
           ORDER BY tasks_fts.rank
           LIMIT 20`,
        )
        .all(query) as Array<Record<string, unknown>>;

      for (const row of rows) {
        results.push({ ...row, type: "task" });
      }
    } catch {
      // FTS5 syntax error — skip tasks
    }
  }

  // Sort combined results by rank (best match first)
  results.sort((a, b) => (a["rank"] as number) - (b["rank"] as number));

  return c.json({ results });
});
