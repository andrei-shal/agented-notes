import { getDb } from "../db/db";
import { calendarEvents } from "../db/schema";
import { eq, and, gte, lte, isNull, sql } from "drizzle-orm";
import { RRule } from "rrule";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Event = typeof calendarEvents.$inferSelect;

export interface CreateEventData {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  rrule?: string;
  reminderMinutes?: number;
  color?: string;
}

export interface UpdateEventData {
  title?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  allDay?: boolean;
  rrule?: string;
  reminderMinutes?: number;
  color?: string;
}

export interface EventOccurrence extends Event {
  /** Flag to distinguish expanded occurrences from stored events. */
  isOccurrence: true;
  /** The startDate of the template event this occurrence was expanded from. */
  originalStartDate: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Safety cap: at most this many occurrences per recurring event. */
export const MAX_OCCURRENCES = 365;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeOccurrenceEndDate(
  occurrenceStart: Date,
  templateStart: Date,
  templateEnd: Date | null,
): Date | null {
  if (!templateEnd) return null;
  const duration = templateEnd.getTime() - templateStart.getTime();
  return duration > 0 ? new Date(occurrenceStart.getTime() + duration) : occurrenceStart;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Create a new calendar event.
 * When `endDate` is omitted and no `rrule` is given, defaults to a single-day
 * event (endDate = startDate).
 */
export function createEvent(data: CreateEventData): Event {
  const finalEndDate =
    data.endDate ?? (data.rrule ? undefined : data.startDate);

  return getDb()
    .insert(calendarEvents)
    .values({
      title: data.title,
      description: data.description ?? null,
      startDate: data.startDate,
      endDate: finalEndDate ?? null,
      allDay: data.allDay ? 1 : 0,
      rrule: data.rrule ?? null,
      reminderMinutes: data.reminderMinutes ?? null,
      color: data.color ?? null,
    })
    .returning()
    .get();
}

/** Get a single event by ID. Returns `undefined` when not found. */
export function getEvent(id: string): Event | undefined {
  const result = getDb()
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.id, id))
    .get();

  return result ?? undefined;
}

/**
 * List all events within the given date range `[from, to]`.
 *
 * 1. Non-recurring events are filtered by `start_date >= from AND end_date <= to`.
 * 2. Recurring events (with an `rrule` field) are expanded via the `rrule`
 *    package.  At most `MAX_OCCURRENCES` per event are returned.
 *
 * Returns a flat array mixing stored events and synthetic occurrences.
 */
export function listEvents(from: string, to: string): (Event | EventOccurrence)[] {
  const fromDate = new Date(from);
  const toDate = new Date(to);

  // 1. Non-recurring events in range
  const nonRecurring = getDb()
    .select()
    .from(calendarEvents)
    .where(
      and(
        isNull(calendarEvents.rrule),
        gte(calendarEvents.startDate, from),
        // Events without an end_date (should not happen for non-recurring
        // events created through this service) fall through the filter.
        lte(calendarEvents.endDate, to),
      ),
    )
    .all();

  // 2. All recurring events
  const recurring = getDb()
    .select()
    .from(calendarEvents)
    .where(sql`${calendarEvents.rrule} IS NOT NULL`)
    .all();

  // 3. Expand occurrences
  const occurrences: EventOccurrence[] = [];

  for (const event of recurring) {
    if (!event.rrule) continue;

    const eventStart = new Date(event.startDate);
    const eventEnd = event.endDate ? new Date(event.endDate) : null;

    // Parse the RRULE string and merge with the event's DTSTART.
    // Skip events with unparseable rrule strings rather than failing the
    // entire listing.
    let rrule: RRule;
    try {
      const options = RRule.parseString(event.rrule);
      rrule = new RRule({ ...options, dtstart: eventStart });
    } catch {
      continue;
    }

    // Bound generation to the requested range (inclusive)
    let dates = rrule.between(fromDate, toDate, true);

    // Safety cap
    if (dates.length > MAX_OCCURRENCES) {
      dates = dates.slice(0, MAX_OCCURRENCES);
    }

    for (const date of dates) {
      const occEnd = computeOccurrenceEndDate(date, eventStart, eventEnd);

      occurrences.push({
        ...event,
        startDate: date.toISOString(),
        endDate: occEnd?.toISOString() ?? null,
        isOccurrence: true as const,
        originalStartDate: event.startDate,
      });
    }
  }

  return [...nonRecurring, ...occurrences];
}

/**
 * Update an existing event.  Only the supplied fields are changed.
 * Returns the updated event, or `undefined` if the event does not exist.
 */
export function updateEvent(id: string, data: UpdateEventData): Event | undefined {
  const updates: Partial<typeof calendarEvents.$inferInsert> = {};

  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.startDate !== undefined) updates.startDate = data.startDate;
  if (data.endDate !== undefined) updates.endDate = data.endDate;
  if (data.allDay !== undefined) updates.allDay = data.allDay ? 1 : 0;
  if (data.rrule !== undefined) updates.rrule = data.rrule;
  if (data.reminderMinutes !== undefined) updates.reminderMinutes = data.reminderMinutes;
  if (data.color !== undefined) updates.color = data.color;

  if (Object.keys(updates).length === 0) {
    return getEvent(id);
  }

  const result = getDb()
    .update(calendarEvents)
    .set(updates)
    .where(eq(calendarEvents.id, id))
    .returning()
    .get();

  return result ?? undefined;
}

/**
 * Delete an event by ID.
 * Returns the deleted event, or `undefined` if it was not found.
 */
export function deleteEvent(id: string): Event | undefined {
  const result = getDb()
    .delete(calendarEvents)
    .where(eq(calendarEvents.id, id))
    .returning()
    .get();

  return result ?? undefined;
}
