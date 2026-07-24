import type { Tool } from "@modelcontextprotocol/sdk/types";
import { tools, type McpTool } from "./registry";
import {
  listBoards,
  listColumns,
  listTasks,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
} from "../../services/kanban";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function textResult(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * List all kanban boards.
 */
const kanban_boards_list: McpTool = {
  definition: {
    name: "kanban_boards_list",
    description: "List all kanban boards with their columns and task counts",
    inputSchema: { type: "object", properties: {}, required: [] },
  } satisfies Tool,
  handler: async () => {
    return textResult(listBoards());
  },
};

/**
 * List columns for a given board.
 */
const kanban_columns_list: McpTool = {
  definition: {
    name: "kanban_columns_list",
    description: "List columns for a kanban board",
    inputSchema: {
      type: "object",
      properties: {
        board_id: {
          type: "string",
          description: "The board ID to list columns for",
        },
      },
      required: ["board_id"],
    },
  } satisfies Tool,
  handler: async (args) => {
    const boardId = String(args["board_id"] ?? "");
    return textResult(listColumns(boardId));
  },
};

/**
 * List tasks in a column.
 */
const kanban_tasks_list: McpTool = {
  definition: {
    name: "kanban_tasks_list",
    description: "List tasks in a kanban column",
    inputSchema: {
      type: "object",
      properties: {
        column_id: {
          type: "string",
          description: "The column ID to list tasks for",
        },
      },
      required: ["column_id"],
    },
  } satisfies Tool,
  handler: async (args) => {
    const columnId = String(args["column_id"] ?? "");
    return textResult(listTasks(columnId));
  },
};

/**
 * Create a new task.
 */
const kanban_task_create: McpTool = {
  definition: {
    name: "kanban_task_create",
    description: "Create a new kanban task",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: {
          type: "string",
          description: "Optional task description",
        },
        column_id: {
          type: "string",
          description: "Column ID to place the task in",
        },
        due_date: {
          type: "string",
          description: "Optional ISO-8601 due date",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags",
        },
      },
      required: ["title", "column_id"],
    },
  } satisfies Tool,
  handler: async (args) => {
    const result = createTask({
      columnId: String(args["column_id"] ?? ""),
      title: String(args["title"] ?? ""),
      description: args["description"] != null ? String(args["description"]) : null,
      dueDate: args["due_date"] != null ? String(args["due_date"]) : null,
      tags: Array.isArray(args["tags"]) ? args["tags"].map(String) : undefined,
    });
    return textResult(result);
  },
};

/**
 * Update an existing task.
 */
const kanban_task_update: McpTool = {
  definition: {
    name: "kanban_task_update",
    description: "Update an existing kanban task",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to update" },
        title: { type: "string", description: "New title" },
        description: {
          type: "string",
          description: "New description (null to clear)",
        },
        due_date: {
          type: "string",
          description: "New ISO-8601 due date (null to clear)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags",
        },
      },
      required: ["task_id"],
    },
  } satisfies Tool,
  handler: async (args) => {
    const result = updateTask(String(args["task_id"] ?? ""), {
      title: args["title"] != null ? String(args["title"]) : undefined,
      description: args["description"] !== undefined
        ? (args["description"] != null ? String(args["description"]) : null)
        : undefined,
      dueDate: args["due_date"] !== undefined
        ? (args["due_date"] != null ? String(args["due_date"]) : null)
        : undefined,
      tags: args["tags"] !== undefined
        ? Array.isArray(args["tags"])
          ? args["tags"].map(String)
          : []
        : undefined,
    });
    return textResult(result);
  },
};

/**
 * Move a task to a different column (or reorder within the same column).
 */
const kanban_task_move: McpTool = {
  definition: {
    name: "kanban_task_move",
    description: "Move a task to another column or reorder within the same column",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to move" },
        target_column_id: {
          type: "string",
          description: "Target column ID",
        },
        target_position: {
          type: "number",
          description: "Optional target position within the column",
        },
      },
      required: ["task_id", "target_column_id"],
    },
  } satisfies Tool,
  handler: async (args) => {
    const taskId = String(args["task_id"] ?? "");
    const targetColumnId = String(args["target_column_id"] ?? "");
    const targetPosition =
      args["target_position"] != null
        ? Number(args["target_position"])
        : undefined;

    const result = moveTask(taskId, targetColumnId, targetPosition);
    return textResult(result);
  },
};

/**
 * Delete a task.
 */
const kanban_task_delete: McpTool = {
  definition: {
    name: "kanban_task_delete",
    description: "Delete a kanban task",
    inputSchema: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "Task ID to delete",
        },
      },
      required: ["task_id"],
    },
  } satisfies Tool,
  handler: async (args) => {
    const taskId = String(args["task_id"] ?? "");
    const result = deleteTask(taskId);
    return textResult(result);
  },
};

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

tools.push(
  kanban_boards_list,
  kanban_columns_list,
  kanban_tasks_list,
  kanban_task_create,
  kanban_task_update,
  kanban_task_move,
  kanban_task_delete,
);
