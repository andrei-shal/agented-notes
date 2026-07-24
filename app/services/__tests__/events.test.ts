import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: All application module imports below are DYNAMIC (inside
// beforeAll).  Static imports of application code would cause db.ts etc.
// to load before env vars are set.
// ═════════════════════════════════════════════════════════════════════════

// ── Test database setup ─────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-events-svc-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

process.env["DATABASE_PATH"] = DB_PATH;

// Create and migrate the test database
{
  const sqlite = new Database(DB_PATH, { create: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const migrationDir = join(import.meta.dir, "../../drizzle");
  const files = Array.from(
    new Bun.Glob("*.sql").scanSync({ cwd: migrationDir }),
  ).sort();
  for (const file of files) {
    const content = readFileSync(join(migrationDir, file), "utf-8");
    for (const stmt of content.split("--> statement-breakpoint\n")) {
      const trimmed = stmt.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
  sqlite.close();
}

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe("Events Service", () => {
  afterAll(() => {
    cleanup();
  });

  test("createEvent creates an event and returns it", async () => {
    const { createEvent } = await import("../../services/events");

    const event = createEvent({
      title: "Team Standup",
      startDate: "2025-07-24T09:00:00.000Z",
      endDate: "2025-07-24T09:30:00.000Z",
      color: "#ff0000",
    });

    expect(event.id).toBeDefined();
    expect(event.title).toBe("Team Standup");
    expect(event.startDate).toBe("2025-07-24T09:00:00.000Z");
    expect(event.endDate).toBe("2025-07-24T09:30:00.000Z");
    expect(event.color).toBe("#ff0000");
    expect(event.rrule).toBeNull();
    expect(event.createdAt).toBeDefined();
  });

  test("createEvent defaults endDate to startDate when not provided and no rrule", async () => {
    const { createEvent } = await import("../../services/events");

    const event = createEvent({
      title: "All-day Event",
      startDate: "2025-08-01T00:00:00.000Z",
    });

    expect(event.endDate).toBe(event.startDate);
  });

  test("createEvent keeps endDate undefined when rrule is provided without endDate", async () => {
    const { createEvent } = await import("../../services/events");

    const event = createEvent({
      title: "Recurring All-day",
      startDate: "2025-08-01T00:00:00.000Z",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });

    expect(event.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    expect(event.endDate).toBeNull();
  });

  test("getEvent returns undefined for non-existent event", async () => {
    const { getEvent } = await import("../../services/events");

    const event = getEvent("non-existent-id");
    expect(event).toBeUndefined();
  });

  test("getEvent returns the event after creation", async () => {
    const { createEvent, getEvent } = await import("../../services/events");

    const created = createEvent({
      title: "Find Me",
      startDate: "2025-09-01T12:00:00.000Z",
    });

    const found = getEvent(created.id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("Find Me");
    expect(found!.id).toBe(created.id);
  });

  test("listEvents returns non-recurring events within the date range", async () => {
    const { createEvent, listEvents } = await import("../../services/events");

    createEvent({
      title: "In Range",
      startDate: "2025-07-15T10:00:00.000Z",
      endDate: "2025-07-15T11:00:00.000Z",
    });

    createEvent({
      title: "Out of Range (before)",
      startDate: "2025-06-01T10:00:00.000Z",
      endDate: "2025-06-01T11:00:00.000Z",
    });

    createEvent({
      title: "Out of Range (after)",
      startDate: "2025-08-01T10:00:00.000Z",
      endDate: "2025-08-01T11:00:00.000Z",
    });

    const events = listEvents("2025-07-01T00:00:00.000Z", "2025-07-31T23:59:59.000Z");

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.title === "In Range")).toBe(true);
    expect(events.some((e) => e.title === "Out of Range (before)")).toBe(false);
    expect(events.some((e) => e.title === "Out of Range (after)")).toBe(false);
  });

  test("listEvents expands recurring events with FREQ=WEEKLY;BYDAY=MO", async () => {
    const { createEvent, listEvents } = await import("../../services/events");

    createEvent({
      title: "Weekly Monday Standup",
      startDate: "2025-07-21T09:00:00.000Z", // Monday
      endDate: "2025-07-21T09:30:00.000Z",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
    });

    // Query July 2025 — contains 4 Mondays (7, 14, 21, 28)
    const events = listEvents("2025-07-01T00:00:00.000Z", "2025-07-31T23:59:59.000Z");

    const mondayEvents = events.filter(
      (e) => e.title === "Weekly Monday Standup",
    );

    // The original event starts on July 21, so weekly expansion gives 21 and 28
    expect(mondayEvents.length).toBe(2);

    // Check occurrence metadata
    const occurrence = mondayEvents.find((e) => "isOccurrence" in e);
    expect(occurrence).toBeDefined();
    if (occurrence && "isOccurrence" in occurrence) {
      expect(occurrence.isOccurrence).toBe(true);
      expect(occurrence.originalStartDate).toBe("2025-07-21T09:00:00.000Z");
    }

    // Duration should carry over to occurrences
    const july28 = mondayEvents.find(
      (e) => e.startDate === "2025-07-28T09:00:00.000Z",
    );
    expect(july28).toBeDefined();
    expect(july28!.endDate).toBe("2025-07-28T09:30:00.000Z");
  });

  test("listEvents enforces MAX_OCCURRENCES per recurring event", async () => {
    const { createEvent, listEvents, MAX_OCCURRENCES } = await import(
      "../../services/events"
    );

    createEvent({
      title: "Frequent Event",
      startDate: "2025-07-01T00:00:00.000Z",
      rrule: "FREQ=MINUTELY",
    });

    // Range of 2 days → 2880 possible occurrences, capped at MAX_OCCURRENCES
    const events = listEvents("2025-07-01T00:00:00.000Z", "2025-07-02T23:59:59.000Z");

    const freqEvents = events.filter((e) => e.title === "Frequent Event");
    expect(freqEvents.length).toBe(MAX_OCCURRENCES);
  });

  test("listEvents returns empty array when no events match", async () => {
    const { listEvents } = await import("../../services/events");

    const events = listEvents("2020-01-01T00:00:00.000Z", "2020-01-31T23:59:59.000Z");

    expect(events.length).toBe(0);
  });

  test("updateEvent modifies fields and returns updated event", async () => {
    const { createEvent, updateEvent, getEvent } = await import(
      "../../services/events"
    );

    const event = createEvent({
      title: "Original Title",
      startDate: "2025-10-01T08:00:00.000Z",
    });

    const updated = updateEvent(event.id, {
      title: "Updated Title",
      color: "#00ff00",
    });

    expect(updated).toBeDefined();
    expect(updated!.title).toBe("Updated Title");
    expect(updated!.color).toBe("#00ff00");
    expect(updated!.startDate).toBe(event.startDate); // unchanged

    // Verify via getEvent
    const fetched = getEvent(event.id);
    expect(fetched!.title).toBe("Updated Title");
  });

  test("updateEvent returns undefined for non-existent id", async () => {
    const { updateEvent } = await import("../../services/events");

    const result = updateEvent("non-existent-id", { title: "Nope" });
    expect(result).toBeUndefined();
  });

  test("deleteEvent removes the event and returns it", async () => {
    const { createEvent, deleteEvent, getEvent } = await import(
      "../../services/events"
    );

    const event = createEvent({
      title: "To Be Deleted",
      startDate: "2025-11-01T00:00:00.000Z",
    });

    const deleted = deleteEvent(event.id);
    expect(deleted).toBeDefined();
    expect(deleted!.id).toBe(event.id);

    const fetched = getEvent(event.id);
    expect(fetched).toBeUndefined();
  });

  test("deleteEvent returns undefined for non-existent id", async () => {
    const { deleteEvent } = await import("../../services/events");

    const result = deleteEvent("non-existent-id");
    expect(result).toBeUndefined();
  });
});
