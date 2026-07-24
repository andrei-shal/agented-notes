import { db } from "../db/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchEntityType = "note" | "task";

export interface SearchResult {
  id: string;
  type: SearchEntityType;
  title: string;
  content?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  rank: number;
}

export type SearchType = "notes" | "tasks" | "all";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set<SearchType>(["notes", "tasks", "all"]);

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check whether a string is a valid search type filter. */
export function isValidType(type: string): type is SearchType {
  return VALID_TYPES.has(type as SearchType);
}

/**
 * Full-text search across notes and/or tasks using FTS5.
 *
 * Returns results sorted by relevance rank (best match first).
 * An empty or whitespace-only query returns an empty array.
 */
export function searchQuery(query: string, type: SearchType = "all"): SearchResult[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFts5(query);
  if (!sanitized) return [];

  const sqlite: typeof db.$client = db.$client;
  const results: SearchResult[] = [];

  // ── Search notes ────────────────────────────────────────────────────

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
        .all(sanitized) as Array<Record<string, unknown>>;

      for (const row of rows) {
        results.push({
          id: row["id"] as string,
          type: "note",
          title: row["title"] as string,
          content: row["content"] as string,
          createdAt: row["created_at"] as string,
          updatedAt: row["updated_at"] as string,
          rank: row["rank"] as number,
        });
      }
    } catch {
      // FTS5 syntax error — skip notes
    }
  }

  // ── Search tasks ────────────────────────────────────────────────────

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
        .all(sanitized) as Array<Record<string, unknown>>;

      for (const row of rows) {
        results.push({
          id: row["id"] as string,
          type: "task",
          title: row["title"] as string,
          description: row["description"] as string,
          createdAt: row["created_at"] as string,
          updatedAt: row["updated_at"] as string,
          rank: row["rank"] as number,
        });
      }
    } catch {
      // FTS5 syntax error — skip tasks
    }
  }

  // Sort combined results by rank (best match first)
  results.sort((a, b) => a.rank - b.rank);

  return results;
}
