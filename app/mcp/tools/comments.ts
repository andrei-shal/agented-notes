import type { McpTool } from "./registry";
import {
  getPendingComments,
  markProcessed,
  deleteComment,
} from "../../services/comments";

// ---------------------------------------------------------------------------
// comments_get_pending — get all non-expired pending comments with parent
//                         entity title
// ---------------------------------------------------------------------------

export const commentsGetPendingTool: McpTool = {
  definition: {
    name: "comments_get_pending",
    description:
      "Return all non-expired pending comments with their parent entity title. " +
      "Agent workflow: call this first, then read the associated note, make changes, " +
      "and finally delete the comment via comments_delete.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  handler: async () => {
    const result = getPendingComments();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  },
};

// ---------------------------------------------------------------------------
// comments_mark_processed — mark a pending comment as processed
// ---------------------------------------------------------------------------

export const commentsMarkProcessedTool: McpTool = {
  definition: {
    name: "comments_mark_processed",
    description: "Mark a pending comment as processed by its id.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The comment id to mark as processed",
        },
      },
      required: ["id"],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const id = String(args["id"] ?? "");
    if (!id) {
      return {
        content: [{ type: "text", text: "Missing required argument: id" }],
        isError: true,
      };
    }

    const updated = markProcessed(id);
    if (!updated) {
      return {
        content: [
          {
            type: "text",
            text: `Comment not found: ${id}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify(updated) }],
    };
  },
};

// ---------------------------------------------------------------------------
// comments_delete — delete a comment by id
// ---------------------------------------------------------------------------

export const commentsDeleteTool: McpTool = {
  definition: {
    name: "comments_delete",
    description: "Delete a comment by its id. Returns success status.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The comment id to delete",
        },
      },
      required: ["id"],
    },
  },
  handler: async (args: Record<string, unknown>) => {
    const id = String(args["id"] ?? "");
    if (!id) {
      return {
        content: [{ type: "text", text: "Missing required argument: id" }],
        isError: true,
      };
    }

    const deleted = deleteComment(id);
    if (!deleted) {
      return {
        content: [
          {
            type: "text",
            text: `Comment not found: ${id}`,
          },
        ],
        isError: true,
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ success: true }) }],
    };
  },
};
