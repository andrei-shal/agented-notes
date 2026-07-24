import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: All app module imports below are DYNAMIC (inside test
// functions).  Static imports of application code would cause db.ts etc.
// to load before env vars are set.
// ═════════════════════════════════════════════════════════════════════════

// ── Test database setup ─────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-mcp-events-test-"));
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

// ── Helper: find a registered tool by name ──────────────────────────

function requireHandler(
  tools: { definition: { name: string }; handler: Function }[],
  name: string,
): (args: Record<string, unknown>) => Promise<unknown> {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool "${name}" is not registered`);
  return tool.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// ═════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════

describe("MCP Events Tools", () => {
  afterAll(() => {
    cleanup();
  });

  test("all 5 event tools are registered", async () => {
    const { tools } = await import("../tools/index");
    // Import the events module to trigger registration (side effect)
    await import("../tools/events");

    const names = tools.map((t) => t.definition.name);
    expect(names).toContain("events_list");
    expect(names).toContain("events_get");
    expect(names).toContain("events_create");
    expect(names).toContain("events_update");
    expect(names).toContain("events_delete");
  });

  describe("events_create", () => {
    test("creates an event and returns it", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const handler = requireHandler(tools, "events_create");

      const result = await handler({
        title: "MCP Test Event",
        startDate: "2025-07-24T10:00:00.000Z",
        endDate: "2025-07-24T11:00:00.000Z",
        color: "#00ff00",
      });

      expect(result).toBeDefined();
      const content = result as { content: { text: string }[] };
      expect(content.content[0]).toBeDefined();
      const event = JSON.parse(content.content[0]!.text);
      expect(event.title).toBe("MCP Test Event");
      expect(event.startDate).toBe("2025-07-24T10:00:00.000Z");
      expect(event.color).toBe("#00ff00");
      expect(event.id).toBeDefined();
    });

    test("returns error when title is missing", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const handler = requireHandler(tools, "events_create");

      const result = await handler({
        startDate: "2025-07-24T10:00:00.000Z",
      });

      const content = result as { content: { text: string }[]; isError?: boolean };
      expect(content.isError).toBe(true);
      expect(content.content[0]!.text).toContain("title");
    });
  });

  describe("events_get", () => {
    test("returns event by ID after creation", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const createHandler = requireHandler(tools, "events_create");
      const getHandler = requireHandler(tools, "events_get");

      const created = await createHandler({
        title: "Get Me",
        startDate: "2025-08-01T12:00:00.000Z",
      });
      const createdContent = created as { content: { text: string }[] };
      const event = JSON.parse(createdContent.content[0]!.text);

      const result = await getHandler({ id: event.id });
      const resultContent = result as { content: { text: string }[] };
      const fetched = JSON.parse(resultContent.content[0]!.text);
      expect(fetched.title).toBe("Get Me");
      expect(fetched.id).toBe(event.id);
    });

    test("returns error for non-existent ID", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const handler = requireHandler(tools, "events_get");

      const result = await handler({ id: "non-existent-id" });
      const content = result as { content: { text: string }[]; isError?: boolean };
      expect(content.isError).toBe(true);
      expect(content.content[0]!.text).toContain("not found");
    });
  });

  describe("events_list", () => {
    test("lists events within date range", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const createHandler = requireHandler(tools, "events_create");
      const listHandler = requireHandler(tools, "events_list");

      await createHandler({
        title: "Listable Event",
        startDate: "2025-07-15T10:00:00.000Z",
        endDate: "2025-07-15T11:00:00.000Z",
      });

      const result = await listHandler({
        from: "2025-07-01T00:00:00.000Z",
        to: "2025-07-31T23:59:59.000Z",
      });
      const content = result as { content: { text: string }[] };
      const events = JSON.parse(content.content[0]!.text);
      expect(Array.isArray(events)).toBe(true);
      expect(events.some((e: { title: string }) => e.title === "Listable Event")).toBe(
        true,
      );
    });

    test("expands recurring events into occurrences", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const createHandler = requireHandler(tools, "events_create");
      const listHandler = requireHandler(tools, "events_list");

      await createHandler({
        title: "Recurring Monday",
        startDate: "2025-07-21T09:00:00.000Z", // Monday
        endDate: "2025-07-21T09:30:00.000Z",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
      });

      const result = await listHandler({
        from: "2025-07-01T00:00:00.000Z",
        to: "2025-07-31T23:59:59.000Z",
      });
      const content = result as { content: { text: string }[] };
      const events = JSON.parse(content.content[0]!.text) as any[];

      const mondays = events.filter((e) => e.title === "Recurring Monday");
      expect(mondays.length).toBe(2); // July 21 and 28

      const occ = mondays.find((e) => e.isOccurrence === true);
      expect(occ).toBeDefined();
      expect(occ!.originalStartDate).toBe("2025-07-21T09:00:00.000Z");
    });

    test("returns error for missing parameters", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const handler = requireHandler(tools, "events_list");

      const result = await handler({});
      const content = result as { content: { text: string }[]; isError?: boolean };
      expect(content.isError).toBe(true);
    });
  });

  describe("events_update", () => {
    test("updates event fields", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const createHandler = requireHandler(tools, "events_create");
      const updateHandler = requireHandler(tools, "events_update");

      const created = await createHandler({
        title: "Update Me",
        startDate: "2025-09-01T08:00:00.000Z",
      });
      const createdContent = created as { content: { text: string }[] };
      const event = JSON.parse(createdContent.content[0]!.text);

      const result = await updateHandler({
        id: event.id,
        title: "Updated Title",
        color: "#ff0000",
      });
      const content = result as { content: { text: string }[] };
      const updated = JSON.parse(content.content[0]!.text);
      expect(updated.title).toBe("Updated Title");
      expect(updated.color).toBe("#ff0000");
      expect(updated.startDate).toBe(event.startDate); // unchanged
    });

    test("returns error for non-existent ID", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const handler = requireHandler(tools, "events_update");

      const result = await handler({
        id: "non-existent-id",
        title: "Nope",
      });
      const content = result as { content: { text: string }[]; isError?: boolean };
      expect(content.isError).toBe(true);
      expect(content.content[0]!.text).toContain("not found");
    });
  });

  describe("events_delete", () => {
    test("deletes an event and returns it", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const createHandler = requireHandler(tools, "events_create");
      const deleteHandler = requireHandler(tools, "events_delete");
      const getHandler = requireHandler(tools, "events_get");

      const created = await createHandler({
        title: "Delete Me",
        startDate: "2025-10-01T00:00:00.000Z",
      });
      const createdContent = created as { content: { text: string }[] };
      const event = JSON.parse(createdContent.content[0]!.text);

      const deletedResult = await deleteHandler({ id: event.id });
      const deletedContent = deletedResult as { content: { text: string }[] };
      const deleted = JSON.parse(deletedContent.content[0]!.text);
      expect(deleted.id).toBe(event.id);

      // Verify it's gone
      const getResult = await getHandler({ id: event.id });
      const getContent = getResult as { content: { text: string }[]; isError?: boolean };
      expect(getContent.isError).toBe(true);
    });

    test("returns error for non-existent ID", async () => {
      const { tools } = await import("../tools/index");
      await import("../tools/events");
      const handler = requireHandler(tools, "events_delete");

      const result = await handler({ id: "non-existent-id" });
      const content = result as { content: { text: string }[]; isError?: boolean };
      expect(content.isError).toBe(true);
      expect(content.content[0]!.text).toContain("not found");
    });
  });
});
