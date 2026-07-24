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

// ── Test database setup (runs at module level, before any test) ─────

const TEST_DIR = mkdtempSync(
  join(tmpdir(), "agented-notes-comments-api-test-"),
);
const DB_PATH = join(TEST_DIR, "test.db");

// Set env vars BEFORE any application module is loaded
process.env["JWT_SECRET"] = "test-jwt-secret-1234567890!";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-abc";
process.env["MCP_API_KEY"] = "test-mcp-api-key-123";
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

// Cleanup temp directory on exit
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

describe("Comments API", () => {
  let api: Awaited<typeof import("../../api/index")>["api"];
  let dbModule: typeof import("../../db/db");
  let schema: typeof import("../../db/schema");

  let noteId: string;
  let authToken: string;

  beforeAll(async () => {
    const apiModule = await import("../../api/index");
    api = apiModule.api;
    dbModule = await import("../../db/db");
    schema = await import("../../db/schema");

    // Reset JWT secret cache so it re-reads from our env
    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();

    authToken = await jwt.generateAccessToken("test-user-id");

    // Insert a test note
    noteId = crypto.randomUUID();
    dbModule.db
      .insert(schema.notes)
      .values({ id: noteId, title: "Test Note", content: "Body" })
      .run();
  });

  afterAll(() => {
    cleanup();
  });

  // ── auth helpers ──────────────────────────────────────────────────

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${authToken}` };
  }

  function jsonHeaders(): Record<string, string> {
    return { "Content-Type": "application/json" };
  }

  // ── POST /api/notes/:noteId/comments ──────────────────────────────

  test("POST creates a pending comment and returns 201", async () => {
    const res = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "API test comment" }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.content).toBe("API test comment");
    expect(body.data.status).toBe("pending");
    expect(body.data.entityType).toBe("note");
    expect(body.data.entityId).toBe(noteId);
    expect(body.data.expiresAt).toBeDefined();
  });

  test("POST without content returns 400", async () => {
    const res = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("content is required");
  });

  test("POST with empty content returns 400", async () => {
    const res = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "   " }),
      }),
    );

    expect(res.status).toBe(400);
  });

  test("POST on non-existent note returns 404", async () => {
    const fakeId = crypto.randomUUID();
    const res = await api.fetch(
      new Request(`http://localhost/api/notes/${fakeId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "Orphan comment" }),
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not found");
  });

  // ── GET /api/notes/:noteId/comments ───────────────────────────────

  test("GET returns comments for a note", async () => {
    // Create a comment first
    await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "List me" }),
      }),
    );

    const res = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "GET",
        headers: authHeaders(),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    for (const c of body.data) {
      expect(c.entityType).toBe("note");
      expect(c.entityId).toBe(noteId);
    }
  });

  test("GET returns empty array for note with no comments", async () => {
    const emptyNoteId = crypto.randomUUID();
    // Note doesn't exist in DB, but the GET endpoint doesn't validate
    // entity existence — it just returns whatever comments exist
    const res = await api.fetch(
      new Request(`http://localhost/api/notes/${emptyNoteId}/comments`, {
        method: "GET",
        headers: authHeaders(),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  // ── PATCH /api/comments/:id/process ───────────────────────────────

  test("PATCH /process marks a pending comment as processed", async () => {
    // Create a comment
    const createRes = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "Process me" }),
      }),
    );
    const { data: created } = await createRes.json();

    // Process it
    const processRes = await api.fetch(
      new Request(`http://localhost/api/comments/${created.id}/process`, {
        method: "PATCH",
        headers: authHeaders(),
      }),
    );

    expect(processRes.status).toBe(200);
    const processBody = await processRes.json();
    expect(processBody.data.status).toBe("processed");
  });

  test("PATCH /process on non-existent comment returns 404", async () => {
    const res = await api.fetch(
      new Request(
        `http://localhost/api/comments/${crypto.randomUUID()}/process`,
        { method: "PATCH", headers: authHeaders() },
      ),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Comment not found");
  });

  // ── DELETE /api/comments/:id ──────────────────────────────────────

  test("DELETE removes a comment", async () => {
    // Create a comment
    const createRes = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "Delete me" }),
      }),
    );
    const { data: created } = await createRes.json();

    // Delete it
    const deleteRes = await api.fetch(
      new Request(`http://localhost/api/comments/${created.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );

    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);

    // Verify it's gone
    const getRes = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "GET",
        headers: authHeaders(),
      }),
    );
    const getBody = await getRes.json();
    expect(getBody.data.find((c: any) => c.id === created.id)).toBeUndefined();
  });

  test("DELETE on non-existent comment returns 404", async () => {
    const res = await api.fetch(
      new Request(`http://localhost/api/comments/${crypto.randomUUID()}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Comment not found");
  });

  // ── GET /api/comments/pending ─────────────────────────────────────

  test("GET /pending returns pending non-expired comments", async () => {
    // Create a fresh pending comment
    const createRes = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "Should be pending" }),
      }),
    );
    const { data: created } = await createRes.json();

    const res = await api.fetch(
      new Request("http://localhost/api/comments/pending", {
        method: "GET",
        headers: authHeaders(),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeInstanceOf(Array);

    const found = body.data.find(
      (p: any) => p.comment.id === created.id,
    );
    expect(found).toBeDefined();
    expect(found.comment.status).toBe("pending");
    expect(found.entityTitle).toBe("Test Note");
  });

  test("GET /pending excludes processed comments", async () => {
    // Create a comment, then process it
    const createRes = await api.fetch(
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { ...authHeaders(), ...jsonHeaders() },
        body: JSON.stringify({ content: "Will be processed" }),
      }),
    );
    const { data: created } = await createRes.json();

    await api.fetch(
      new Request(`http://localhost/api/comments/${created.id}/process`, {
        method: "PATCH",
        headers: authHeaders(),
      }),
    );

    const res = await api.fetch(
      new Request("http://localhost/api/comments/pending", {
        method: "GET",
        headers: authHeaders(),
      }),
    );

    const body = await res.json();
    expect(
      body.data.find((p: any) => p.comment.id === created.id),
    ).toBeUndefined();
  });

  // ── Auth protection ──────────────────────────────────────────────

  test("all comment endpoints return 401 without auth token", async () => {
    const endpoints = [
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "GET",
      }),
      new Request(`http://localhost/api/notes/${noteId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "x" }),
      }),
      new Request(
        `http://localhost/api/comments/${crypto.randomUUID()}/process`,
        { method: "PATCH" },
      ),
      new Request(`http://localhost/api/comments/${crypto.randomUUID()}`, {
        method: "DELETE",
      }),
      new Request("http://localhost/api/comments/pending", { method: "GET" }),
    ];

    for (const req of endpoints) {
      const res = await api.fetch(req);
      expect(res.status).toBe(401);
    }
  });
});
