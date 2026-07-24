import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ═════════════════════════════════════════════════════════════════════════
// IMPORTANT: All application module imports below are DYNAMIC (inside
// beforeAll).  Static imports of application code would cause db.ts etc.
// to load before env vars are set.
// ═════════════════════════════════════════════════════════════════════════

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-events-api-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

process.env["JWT_SECRET"] = "test-jwt-secret-for-events-api-1234567890!";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-events";
process.env["MCP_API_KEY"] = "test-mcp-api-key-events-123";
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

describe("Events API", () => {
  let api: Awaited<typeof import("../../api/index")>["api"];
  let accessToken: string;

  beforeAll(async () => {
    const apiModule = await import("../../api/index");
    api = apiModule.api;

    // Reset JWT secret cache
    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();

    accessToken = await jwt.generateAccessToken("test-user-id");
  });

  afterAll(() => {
    cleanup();
  });

  // ── POST /api/events ──────────────────────────────────────────────

  test("POST /api/events creates an event", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "Test Event",
          startDate: "2025-07-24T10:00:00.000Z",
          endDate: "2025-07-24T11:00:00.000Z",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("Test Event");
    expect(body.startDate).toBe("2025-07-24T10:00:00.000Z");
    expect(body.rrule).toBeNull();
  });

  test("POST /api/events with missing title returns 400", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          startDate: "2025-07-24T10:00:00.000Z",
        }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/events with invalid rrule returns 400", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "Bad Rule",
          startDate: "2025-07-24T10:00:00.000Z",
          rrule: "NOT-A-VALID-RRULE",
        }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  // ── GET /api/events?from=...&to=... ───────────────────────────────

  test("GET /api/events?from=...&to=... lists events in range", async () => {
    // Create an event first
    const createRes = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "Range Event",
          startDate: "2025-07-15T10:00:00.000Z",
          endDate: "2025-07-15T11:00:00.000Z",
        }),
      }),
    );
    expect(createRes.status).toBe(201);

    const res = await api.fetch(
      new Request(
        "http://localhost/api/events?from=2025-07-01T00:00:00.000Z&to=2025-07-31T23:59:59.000Z",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.some((e: { title: string }) => e.title === "Range Event")).toBe(true);
  });

  test("GET /api/events without query params returns 400", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events", {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    expect(res.status).toBe(400);
  });

  test("GET /api/events expands recurring events with RRULE date range", async () => {
    // Create a weekly recurring event
    const createRes = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "API Weekly Standup",
          startDate: "2025-07-21T09:00:00.000Z",
          endDate: "2025-07-21T09:30:00.000Z",
          rrule: "FREQ=WEEKLY;BYDAY=MO",
        }),
      }),
    );
    expect(createRes.status).toBe(201);

    // Query July 2025 (4 Mondays: 7, 14, 21, 28)
    const res = await api.fetch(
      new Request(
        "http://localhost/api/events?from=2025-07-01T00:00:00.000Z&to=2025-07-31T23:59:59.000Z",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      ),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const standups = body.filter(
      (e: { title: string }) => e.title === "API Weekly Standup",
    );
    // The original starts July 21, so we get July 21 and 28
    expect(standups.length).toBe(2);

    // Check occurrence has isOccurrence flag
    expect(standups[1].isOccurrence).toBe(true);
    expect(standups[1].originalStartDate).toBe("2025-07-21T09:00:00.000Z");
  });

  // ── PUT /api/events/:id ───────────────────────────────────────────

  test("PUT /api/events/:id updates an event", async () => {
    const createRes = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "Before Update",
          startDate: "2025-08-01T12:00:00.000Z",
        }),
      }),
    );
    const created = await createRes.json();

    const updateRes = await api.fetch(
      new Request(`http://localhost/api/events/${created.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "After Update",
          color: "#0000ff",
        }),
      }),
    );

    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.title).toBe("After Update");
    expect(updated.color).toBe("#0000ff");
    expect(updated.startDate).toBe(created.startDate); // unchanged
  });

  test("PUT /api/events/:id with non-existent id returns 404", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events/non-existent-id", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ title: "Nope" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  // ── DELETE /api/events/:id ────────────────────────────────────────

  test("DELETE /api/events/:id deletes an event", async () => {
    const createRes = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          title: "To Delete",
          startDate: "2025-09-01T00:00:00.000Z",
        }),
      }),
    );
    const created = await createRes.json();

    const deleteRes = await api.fetch(
      new Request(`http://localhost/api/events/${created.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    expect(deleteRes.status).toBe(200);
    const body = await deleteRes.json();
    expect(body.message).toBe("Event deleted");
  });

  test("DELETE /api/events/:id with non-existent id returns 404", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events/non-existent-id", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    expect(res.status).toBe(404);
  });

  // ── Auth middleware ───────────────────────────────────────────────

  test("POST /api/events without auth returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "No Auth",
          startDate: "2025-07-24T10:00:00.000Z",
        }),
      }),
    );

    expect(res.status).toBe(401);
  });
});
