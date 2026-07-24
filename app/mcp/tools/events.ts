import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import { tools } from "./registry";
import {
  listEvents,
  getEvent,
  createEvent as createEventSvc,
  updateEvent as updateEventSvc,
  deleteEvent as deleteEventSvc,
} from "../../services/events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serialise a result value to a text-only MCP tool response. */
function textResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Build an error response with the given message. */
function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// events_list
// ---------------------------------------------------------------------------

const eventsListTool: Tool = {
  name: "events_list",
  description:
    "List calendar events in a date range, expanding recurring events into individual occurrences.",
  inputSchema: {
    type: "object",
    properties: {
      from: {
        type: "string",
        description: "ISO 8601 date-time string for the range start (inclusive).",
      },
      to: {
        type: "string",
        description: "ISO 8601 date-time string for the range end (inclusive).",
      },
    },
    required: ["from", "to"],
  },
};

async function eventsListHandler(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const from = String(args["from"] ?? "");
  const to = String(args["to"] ?? "");

  if (!from || !to) {
    return errorResult("Both 'from' and 'to' parameters are required.");
  }

  try {
    new Date(from).toISOString();
  } catch {
    return errorResult(`'from' is not a valid ISO date string: ${from}`);
  }
  try {
    new Date(to).toISOString();
  } catch {
    return errorResult(`'to' is not a valid ISO date string: ${to}`);
  }

  const events = listEvents(from, to);
  return textResult(events);
}

// ---------------------------------------------------------------------------
// events_get
// ---------------------------------------------------------------------------

const eventsGetTool: Tool = {
  name: "events_get",
  description: "Get a single calendar event by its ID.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The event ID (UUID).",
      },
    },
    required: ["id"],
  },
};

async function eventsGetHandler(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const id = String(args["id"] ?? "");

  if (!id) {
    return errorResult("'id' parameter is required.");
  }

  const event = getEvent(id);
  if (!event) {
    return errorResult(`Event not found: ${id}`);
  }

  return textResult(event);
}

// ---------------------------------------------------------------------------
// events_create
// ---------------------------------------------------------------------------

const eventsCreateTool: Tool = {
  name: "events_create",
  description: "Create a new calendar event.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Event title." },
      description: {
        type: "string",
        description: "Optional event description.",
      },
      startDate: {
        type: "string",
        description: "ISO 8601 date-time string for the event start.",
      },
      endDate: {
        type: "string",
        description:
          "ISO 8601 date-time string for the event end. Omit for all-day or recurring events without a fixed end.",
      },
      allDay: {
        type: "boolean",
        description: "Whether the event spans the entire day.",
      },
      rrule: {
        type: "string",
        description:
          "RRULE string for recurring events (e.g. 'FREQ=WEEKLY;BYDAY=MO').",
      },
      reminderMinutes: {
        type: "number",
        description: "Minutes before the event to trigger a reminder.",
      },
      color: {
        type: "string",
        description: "Hex colour code for the event (e.g. '#ff0000').",
      },
    },
    required: ["title", "startDate"],
  },
};

async function eventsCreateHandler(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const title = String(args["title"] ?? "");
  const startDate = String(args["startDate"] ?? "");

  if (!title) {
    return errorResult("'title' parameter is required.");
  }
  if (!startDate) {
    return errorResult("'startDate' parameter is required.");
  }

  const event = createEventSvc({
    title,
    description: args["description"] != null ? String(args["description"]) : undefined,
    startDate,
    endDate: args["endDate"] != null ? String(args["endDate"]) : undefined,
    allDay: args["allDay"] != null ? Boolean(args["allDay"]) : undefined,
    rrule: args["rrule"] != null ? String(args["rrule"]) : undefined,
    reminderMinutes:
      args["reminderMinutes"] != null ? Number(args["reminderMinutes"]) : undefined,
    color: args["color"] != null ? String(args["color"]) : undefined,
  });

  return textResult(event);
}

// ---------------------------------------------------------------------------
// events_update
// ---------------------------------------------------------------------------

const eventsUpdateTool: Tool = {
  name: "events_update",
  description: "Update an existing calendar event. Only supplied fields are changed.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The event ID (UUID)." },
      title: { type: "string", description: "New event title." },
      description: {
        type: "string",
        description: "New event description.",
      },
      startDate: {
        type: "string",
        description: "New ISO 8601 start date-time.",
      },
      endDate: {
        type: "string",
        description: "New ISO 8601 end date-time.",
      },
      allDay: {
        type: "boolean",
        description: "Whether the event spans the entire day.",
      },
      rrule: {
        type: "string",
        description:
          "New RRULE string for recurring events. Set to an empty string to remove the rule.",
      },
      reminderMinutes: {
        type: "number",
        description: "New reminder minutes before the event.",
      },
      color: {
        type: "string",
        description: "New hex colour code.",
      },
    },
    required: ["id"],
  },
};

function maybeString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  return s === "" ? undefined : s;
}

async function eventsUpdateHandler(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const id = String(args["id"] ?? "");

  if (!id) {
    return errorResult("'id' parameter is required.");
  }

  const updates: Record<string, unknown> = {};

  if (args["title"] !== undefined) updates["title"] = String(args["title"]);
  if (args["description"] !== undefined) {
    updates["description"] = String(args["description"]);
  }
  if (args["startDate"] !== undefined) updates["startDate"] = String(args["startDate"]);
  if (args["endDate"] !== undefined) updates["endDate"] = String(args["endDate"]);
  if (args["allDay"] !== undefined) updates["allDay"] = Boolean(args["allDay"]);
  if (args["rrule"] !== undefined) updates["rrule"] = maybeString(args["rrule"]);
  if (args["reminderMinutes"] !== undefined) {
    updates["reminderMinutes"] = Number(args["reminderMinutes"]);
  }
  if (args["color"] !== undefined) updates["color"] = String(args["color"]);

  const event = updateEventSvc(id, updates);
  if (!event) {
    return errorResult(`Event not found: ${id}`);
  }

  return textResult(event);
}

// ---------------------------------------------------------------------------
// events_delete
// ---------------------------------------------------------------------------

const eventsDeleteTool: Tool = {
  name: "events_delete",
  description: "Delete a calendar event by its ID.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The event ID (UUID).",
      },
    },
    required: ["id"],
  },
};

async function eventsDeleteHandler(
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const id = String(args["id"] ?? "");

  if (!id) {
    return errorResult("'id' parameter is required.");
  }

  const event = deleteEventSvc(id);
  if (!event) {
    return errorResult(`Event not found: ${id}`);
  }

  return textResult(event);
}

// ---------------------------------------------------------------------------
// Register tools
// ---------------------------------------------------------------------------

tools.push(
  { definition: eventsListTool, handler: eventsListHandler },
  { definition: eventsGetTool, handler: eventsGetHandler },
  { definition: eventsCreateTool, handler: eventsCreateHandler },
  { definition: eventsUpdateTool, handler: eventsUpdateHandler },
  { definition: eventsDeleteTool, handler: eventsDeleteHandler },
);
