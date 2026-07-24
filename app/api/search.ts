import { Hono } from "hono";
import { searchQuery, isValidType } from "../services/search";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const searchRouter = new Hono();

// ── GET /api/search?q=xxx&type=notes|tasks|all ──────────────────────────

searchRouter.get("/", async (c) => {
  const q = c.req.query("q");
  const rawType = c.req.query("type") ?? "all";

  if (!q?.trim()) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  if (!isValidType(rawType)) {
    return c.json({ error: "Invalid type" }, 400);
  }

  const results = searchQuery(q, rawType);
  return c.json({ results });
});
