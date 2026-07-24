/**
 * Notes API integration tests.
 *
 * Uses a temporary SQLite database and a real Hono `api` instance.
 * Authentication token is generated via the jwt lib for protected routes.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";

// ── Test database ───────────────────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-api-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

process.env["DATABASE_PATH"] = DB_PATH;
process.env["JWT_SECRET"] = "test-jwt-secret-for-notes-api-tests-12345";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-api";
process.env["MCP_API_KEY"] = "test-mcp-api-key-api";

// Create, migrate, and FTS5-setup the test database
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

  // FTS5 setup
  sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(content);
    CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
      DELETE FROM notes_fts WHERE rowid = old.rowid;
    END;
    CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
      REPLACE INTO notes_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);
  sqlite.close();
}

function cleanup(): void {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const BASE = "http://localhost/api/notes";

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Notes API", () => {
  let api: typeof import("../index")["api"];
  let token: string;

  beforeAll(async () => {
    // Reset JWT secret cache so it re-reads from env
    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();

    const apiModule = await import("../index");
    api = apiModule.api;

    token = await jwt.generateAccessToken("test-user-id");
  });

  afterAll(() => {
    cleanup();
  });

  // ── Auth guard ────────────────────────────────────────────────────

  test("GET /api/notes returns 401 without token", async () => {
    const res = await api.fetch(new Request(BASE));
    expect(res.status).toBe(401);
  });

  // ── POST /api/notes ───────────────────────────────────────────────

  test("POST /api/notes creates a note", async () => {
    const res = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          title: "API Test Note",
          content: "Created via API with #apitag",
        }),
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe("API Test Note");
    expect(body.tags).toContain("apitag");
  });

  test("POST /api/notes returns 400 for missing title", async () => {
    const res = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ content: "no title" }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  test("POST /api/notes returns 400 for empty title", async () => {
    const res = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "", content: "empty title" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  // ── GET /api/notes/:id ────────────────────────────────────────────

  test("GET /api/notes/:id returns a note", async () => {
    // Create first
    const createRes = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Fetch Me", content: "content" }),
      }),
    );
    const created = await createRes.json();

    const res = await api.fetch(
      new Request(`${BASE}/${created.id}`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(created.id);
    expect(body.title).toBe("Fetch Me");
    expect(body.comments).toEqual([]);
  });

  test("GET /api/notes/:id returns 404 for non-existent", async () => {
    const res = await api.fetch(
      new Request(`${BASE}/non-existent-id`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(404);
  });

  // ── GET /api/notes ────────────────────────────────────────────────

  test("GET /api/notes lists notes with pagination metadata", async () => {
    const res = await api.fetch(
      new Request(`${BASE}?limit=5`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.notes)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  test("GET /api/notes filters by tag", async () => {
    const tagName = `tag${crypto.randomUUID().slice(0, 8)}`;
    await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Tagged Note", content: `#${tagName}` }),
      }),
    );

    const res = await api.fetch(
      new Request(`${BASE}?tag=${tagName}`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    for (const note of body.notes) {
      expect(note.tags).toContain(tagName);
    }
  });

  test("GET /api/notes searches via FTS5", async () => {
    // Create a note with unique searchable content
    const searchTerm = `unique_search_${crypto.randomUUID().slice(0, 8)}`;
    await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Searchable", content: searchTerm }),
      }),
    );

    const res = await api.fetch(
      new Request(`${BASE}?search=${searchTerm}`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/notes paginates correctly", async () => {
    const res = await api.fetch(
      new Request(`${BASE}?limit=2&offset=0`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes.length).toBeLessThanOrEqual(2);
  });

  // ── PUT /api/notes/:id ────────────────────────────────────────────

  test("PUT /api/notes/:id updates a note", async () => {
    const createRes = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Before", content: "old content" }),
      }),
    );
    const created = await createRes.json();

    const res = await api.fetch(
      new Request(`${BASE}/${created.id}`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "After", content: "new #tagcontent" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("After");
    expect(body.tags).toContain("tagcontent");
  });

  test("PUT /api/notes/:id returns 404 for non-existent", async () => {
    const res = await api.fetch(
      new Request(`${BASE}/no-such-id`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Nope" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  test("PUT /api/notes/:id returns 400 for invalid body", async () => {
    // Create a note first
    const createRes = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Valid", content: "content" }),
      }),
    );
    const created = await createRes.json();

    const res = await api.fetch(
      new Request(`${BASE}/${created.id}`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  // ── DELETE /api/notes/:id ─────────────────────────────────────────

  test("DELETE /api/notes/:id deletes a note", async () => {
    const createRes = await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ title: "Delete Me", content: "bye" }),
      }),
    );
    const created = await createRes.json();

    const delRes = await api.fetch(
      new Request(`${BASE}/${created.id}`, {
        method: "DELETE",
        headers: authHeaders(token),
      }),
    );

    expect(delRes.status).toBe(200);
    const body = await delRes.json();
    expect(body.message).toBe("Note deleted");

    // Verify it's gone
    const getRes = await api.fetch(
      new Request(`${BASE}/${created.id}`, {
        headers: authHeaders(token),
      }),
    );
    expect(getRes.status).toBe(404);
  });

  test("DELETE /api/notes/:id returns 404 for non-existent", async () => {
    const res = await api.fetch(
      new Request(`${BASE}/no-such-id`, {
        method: "DELETE",
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(404);
  });

  // ── Combined: tag + search filter ─────────────────────────────────

  test("GET /api/notes with tag and search together works", async () => {
    const unique = crypto.randomUUID().slice(0, 8);
    const tagName = `combo${unique}`;
    const searchTerm = `combo_content_${unique}`;

    // Create a note matching both
    await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          title: "Combo",
          content: `${searchTerm} #${tagName}`,
        }),
      }),
    );

    // Create a note matching only the tag
    await api.fetch(
      new Request(BASE, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          title: "Tag Only",
          content: `other content #${tagName}`,
        }),
      }),
    );

    // Search with both filters
    const res = await api.fetch(
      new Request(`${BASE}?tag=${tagName}&search=${searchTerm}`, {
        headers: authHeaders(token),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    for (const note of body.notes) {
      expect(note.tags).toContain(tagName);
      expect(note.content).toContain(searchTerm);
    }
  });
});
