import type { McpTool } from "./index";
import {
  createNote,
  getNote,
  listNotes,
  updateNote,
  deleteNote,
  NotFoundError,
} from "../../services/notes";
import { getTags } from "../../services/analytics";

// ── notes_list ───────────────────────────────────────────────────────────────

const notesListTool: McpTool = {
  definition: {
    name: "notes_list",
    description: "List notes with optional tag filter, search, and pagination",
    inputSchema: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Filter by tag name" },
        search: { type: "string", description: "Full-text search query" },
        limit: {
          type: "number",
          description: "Maximum results (1-100, default 20)",
        },
        offset: { type: "number", description: "Number of results to skip" },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = listNotes({
        tag: args["tag"] as string | undefined,
        search: args["search"] as string | undefined,
        limit: args["limit"] as number | undefined,
        offset: args["offset"] as number | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
};

// ── notes_get ────────────────────────────────────────────────────────────────

const notesGetTool: McpTool = {
  definition: {
    name: "notes_get",
    description: "Get a single note by its ID, including tags and comments",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note ID" },
      },
      required: ["id"],
    },
  },
  handler: async (args) => {
    try {
      const id = args["id"] as string;
      const note = getNote(id);
      if (!note) {
        return {
          content: [{ type: "text", text: `Note not found: ${id}` }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(note) }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
};

// ── notes_create ─────────────────────────────────────────────────────────────

const notesCreateTool: McpTool = {
  definition: {
    name: "notes_create",
    description: "Create a new note. Hashtags in content become tags automatically.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Note title" },
        content: { type: "string", description: "Note content (plain text)" },
      },
      required: ["title", "content"],
    },
  },
  handler: async (args) => {
    try {
      const title = args["title"] as string;
      const content = args["content"] as string;
      const note = createNote(title, content);
      return { content: [{ type: "text", text: JSON.stringify(note) }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
};

// ── notes_update ─────────────────────────────────────────────────────────────

const notesUpdateTool: McpTool = {
  definition: {
    name: "notes_update",
    description:
      "Update an existing note. Omitting title/content leaves the field unchanged. Hashtags are re-parsed from the new content.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note ID" },
        title: { type: "string", description: "New title (optional)" },
        content: { type: "string", description: "New content (optional)" },
      },
      required: ["id"],
    },
  },
  handler: async (args) => {
    try {
      const id = args["id"] as string;
      const title = args["title"] as string | undefined;
      const content = args["content"] as string | undefined;
      const note = updateNote(id, { title, content });
      return { content: [{ type: "text", text: JSON.stringify(note) }] };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          content: [{ type: "text", text: error.message }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
};

// ── notes_delete ─────────────────────────────────────────────────────────────

const notesDeleteTool: McpTool = {
  definition: {
    name: "notes_delete",
    description: "Delete a note and its associated comments and orphaned tags",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Note ID" },
      },
      required: ["id"],
    },
  },
  handler: async (args) => {
    try {
      const id = args["id"] as string;
      deleteNote(id);
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true, id }) }],
      };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          content: [{ type: "text", text: error.message }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
};

// ── tags_list ────────────────────────────────────────────────────────────────

const tagsListTool: McpTool = {
  definition: {
    name: "tags_list",
    description: "List all tags used across notes",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    try {
      const rows = getTags();
      return { content: [{ type: "text", text: JSON.stringify(rows) }] };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      };
    }
  },
};

// ── Exports ──────────────────────────────────────────────────────────────────

export {
  notesListTool,
  notesGetTool,
  notesCreateTool,
  notesUpdateTool,
  notesDeleteTool,
  tagsListTool,
};

export const noteTools: McpTool[] = [
  notesListTool,
  notesGetTool,
  notesCreateTool,
  notesUpdateTool,
  notesDeleteTool,
  tagsListTool,
];
