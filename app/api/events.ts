import { Hono } from "hono";
import { z } from "zod";
import { RRule } from "rrule";
import * as eventsService from "../services/events";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate that an RRULE string is parseable by the rrule library. */
function isValidRrule(val: string): boolean {
  try {
    RRule.parseString(val);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const rruleField = z
  .string()
  .refine(isValidRrule, { message: "Invalid rrule format" })
  .optional();

const createEventSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  allDay: z.boolean().optional().default(false),
  rrule: rruleField,
  reminderMinutes: z.number().int().positive().optional(),
  color: z.string().optional(),
});

const updateEventSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  allDay: z.boolean().optional(),
  rrule: rruleField,
  reminderMinutes: z.number().int().positive().optional(),
  color: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eventsRouter = new Hono();

// ── GET /api/events?from=ISO&to=ISO ─────────────────────────────────

eventsRouter.get("/", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");

  if (!from || !to) {
    return c.json({ error: "from and to query parameters are required" }, 400);
  }

  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return c.json({ error: "Invalid date format. Use ISO 8601" }, 400);
  }

  try {
    const events = eventsService.listEvents(from, to);
    return c.json(events);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list events";
    return c.json({ error: message }, 400);
  }
});

// ── POST /api/events ─────────────────────────────────────────────────

eventsRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      400,
    );
  }

  try {
    const event = eventsService.createEvent(parsed.data);
    return c.json(event, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create event";
    return c.json({ error: message }, 400);
  }
});

// ── PUT /api/events/:id ──────────────────────────────────────────────

eventsRouter.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      400,
    );
  }

  const existing = eventsService.getEvent(id);
  if (!existing) {
    return c.json({ error: "Event not found" }, 404);
  }

  try {
    const updated = eventsService.updateEvent(id, parsed.data);
    if (!updated) {
      return c.json({ error: "Event not found" }, 404);
    }
    return c.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update event";
    return c.json({ error: message }, 400);
  }
});

// ── DELETE /api/events/:id ───────────────────────────────────────────

eventsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");

  const existing = eventsService.getEvent(id);
  if (!existing) {
    return c.json({ error: "Event not found" }, 404);
  }

  try {
    eventsService.deleteEvent(id);
    return c.json({ message: "Event deleted" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete event";
    return c.json({ error: message }, 400);
  }
});
