import { tools, type McpTool } from "./registry";
import { searchQuery, isValidType } from "../../services/search";
import type { SearchType } from "../../services/search";

// ---------------------------------------------------------------------------
// search_query — full-text search across notes and tasks
// ---------------------------------------------------------------------------

export const searchQueryTool: McpTool = {
  definition: {
    name: "search_query",
    description:
      "Full-text search across notes and/or tasks using FTS5. " +
      "Supports FTS5 syntax (AND, OR, NOT, prefix *, phrase \"\"). " +
      'Returns at most 20 results per entity type, sorted by relevance.',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (supports FTS5 syntax)",
        },
        type: {
          type: "string",
          enum: ["notes", "tasks", "all"],
          description:
            'Entity type filter: "notes", "tasks", or "all" (default)',
        },
      },
      required: ["query"],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const query = String(args["query"] ?? "").trim();
    if (!query) {
      return {
        content: [{ type: "text", text: 'Missing required argument: "query"' }],
        isError: true,
      };
    }

    const rawType = String(args["type"] ?? "all");
    const type = rawType.toLowerCase();

    if (!isValidType(type)) {
      return {
        content: [
          {
            type: "text",
            text: `Invalid type "${rawType}". Must be "notes", "tasks", or "all".`,
          },
        ],
        isError: true,
      };
    }

    const results = searchQuery(query, type as SearchType);
    return {
      content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
    };
  },
};

// ── Register ─────────────────────────────────────────────────────────────────

tools.push(searchQueryTool);
