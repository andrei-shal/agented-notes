import { tools, type McpTool } from "./registry";
import { getStats, getTags, getActivity } from "../../services/analytics";

// ---------------------------------------------------------------------------
// analytics_stats — global aggregate statistics
// ---------------------------------------------------------------------------

export const analyticsStatsTool: McpTool = {
  definition: {
    name: "analytics_stats",
    description:
      "Return global aggregate statistics across all entity types: " +
      "total notes, total tasks, tasks broken down by column, " +
      "total events, comments by status, and total tags.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    const stats = getStats();
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
    };
  },
};

// ---------------------------------------------------------------------------
// analytics_tags — tag usage frequency
// ---------------------------------------------------------------------------

export const analyticsTagsTool: McpTool = {
  definition: {
    name: "analytics_tags",
    description:
      "Return all tags sorted by usage frequency (most used first). " +
      "Each entry contains the tag name and the number of notes it appears on.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    const tagList = getTags();
    return {
      content: [
        { type: "text", text: JSON.stringify({ tags: tagList }, null, 2) },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// analytics_activity — daily creation activity (last 30 days)
// ---------------------------------------------------------------------------

export const analyticsActivityTool: McpTool = {
  definition: {
    name: "analytics_activity",
    description:
      "Return daily activity for the last 30 days: notes created and " +
      "tasks created per day. Days with zero activity for both types " +
      "are not included.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    const activity = getActivity();
    return {
      content: [
        { type: "text", text: JSON.stringify({ activity }, null, 2) },
      ],
    };
  },
};

// ── Register ─────────────────────────────────────────────────────────────────

tools.push(analyticsStatsTool, analyticsTagsTool, analyticsActivityTool);
