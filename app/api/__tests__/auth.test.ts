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

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-auth-test-"));
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

describe("Auth API", () => {
  let api: Awaited<typeof import("../../api/index")>["api"];

  beforeAll(async () => {
    const apiModule = await import("../../api/index");
    api = apiModule.api;

    // Reset JWT secret cache so it re-reads from our env
    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();
  });

  afterAll(() => {
    cleanup();
  });

  // ── POST /api/auth/telegram ──────────────────────────────────────

  test("POST /api/auth/telegram with valid initData returns 200 + tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = { id: 12345, username: "testuser" };

    const { createTestInitData } = await import("../../lib/telegram");
    const initData = createTestInitData("1234567890:test-bot-token-abc", {
      auth_date: String(now),
      query_id: "test-query-id",
      user: JSON.stringify(user),
    });

    const res = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      }),
    );

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.accessToken).toBeDefined();
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessToken.split(".")).toHaveLength(3);

    // Set-Cookie header
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("refreshToken=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/api/auth");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Max-Age=");
  });

  test("POST /api/auth/telegram with missing initData returns 400", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("POST /api/auth/telegram with invalid initData returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: "hash=invalid&auth_date=100" }),
      }),
    );

    expect(res.status).toBe(401);
  });

  // ── POST /api/auth/refresh ───────────────────────────────────────

  test("POST /api/auth/refresh with valid cookie returns 200", async () => {
    // First login to get a refresh token
    const now = Math.floor(Date.now() / 1000);
    const user = { id: 12345, username: "testuser" };

    const { createTestInitData } = await import("../../lib/telegram");
    const loginInitData = createTestInitData("1234567890:test-bot-token-abc", {
      auth_date: String(now),
      query_id: "refresh-test",
      user: JSON.stringify(user),
    });

    const loginRes = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: loginInitData }),
      }),
    );

    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get("Set-Cookie")!;

    // Extract the cookie value for the refresh request
    const refreshTokenMatch = setCookie.match(/refreshToken=([^;]+)/);
    expect(refreshTokenMatch).not.toBeNull();
    const refreshToken = refreshTokenMatch![1];

    // Now refresh
    const refreshRes = await api.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: `refreshToken=${refreshToken}` },
      }),
    );

    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.accessToken).toBeDefined();
    expect(typeof refreshBody.accessToken).toBe("string");

    // Should have set a new refresh cookie
    const newCookie = refreshRes.headers.get("Set-Cookie");
    expect(newCookie).toBeDefined();
  });

  test("POST /api/auth/refresh without cookie returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/auth/refresh", { method: "POST" }),
    );

    expect(res.status).toBe(401);
  });

  // ── POST /api/auth/logout ────────────────────────────────────────

  test("POST /api/auth/logout clears cookie and blacklists token", async () => {
    // Login to get a refresh token
    const now = Math.floor(Date.now() / 1000);
    const user = { id: 67890, username: "logoutuser" };

    const { createTestInitData } = await import("../../lib/telegram");
    const loginInitData = createTestInitData("1234567890:test-bot-token-abc", {
      auth_date: String(now),
      query_id: "logout-test",
      user: JSON.stringify(user),
    });

    const loginRes = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: loginInitData }),
      }),
    );

    const setCookie = loginRes.headers.get("Set-Cookie")!;
    const refreshTokenMatch = setCookie.match(/refreshToken=([^;]+)/);
    expect(refreshTokenMatch).not.toBeNull();
    const refreshToken = refreshTokenMatch![1];

    // Logout
    const logoutRes = await api.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: `refreshToken=${refreshToken}` },
      }),
    );

    expect(logoutRes.status).toBe(200);

    // Cookie should be cleared
    const clearCookie = logoutRes.headers.get("Set-Cookie");
    expect(clearCookie).toBeDefined();
    expect(clearCookie).toContain("Max-Age=0");

    // The token should now be blacklisted — refresh should fail
    const refreshRes = await api.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: `refreshToken=${refreshToken}` },
      }),
    );

    expect(refreshRes.status).toBe(401);
  });

  test("POST /api/auth/logout without cookie returns 200", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );

    expect(res.status).toBe(200);
  });

  // ── Auth middleware ──────────────────────────────────────────────

  test("GET /api/notes without bearer token returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/notes", { method: "GET" }),
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("GET /api/notes with invalid bearer token returns 401", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/notes", {
        method: "GET",
        headers: { Authorization: "Bearer invalid-token" },
      }),
    );

    expect(res.status).toBe(401);
  });

  test("GET /api/notes with valid bearer token returns 200 (notes handler mounted)", async () => {
    const { generateAccessToken } = await import("../../lib/jwt");
    const token = await generateAccessToken("test-user-id");

    const res = await api.fetch(
      new Request("http://localhost/api/notes", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
  });

  test("POST /api/auth/telegram is accessible without bearer token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = { id: 77777, username: "authtest" };

    const { createTestInitData } = await import("../../lib/telegram");
    const initData = createTestInitData("1234567890:test-bot-token-abc", {
      auth_date: String(now),
      query_id: "middleware-test",
      user: JSON.stringify(user),
    });

    // No Authorization header → should still work (auth middleware skips /auth/*)
    const res = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      }),
    );

    expect(res.status).toBe(200);
  });

  // ── Refresh token rotation ───────────────────────────────────────

  test("refresh token can only be used once (rotation)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const user = { id: 99999, username: "rotationuser" };

    const { createTestInitData } = await import("../../lib/telegram");
    const initData = createTestInitData("1234567890:test-bot-token-abc", {
      auth_date: String(now),
      query_id: "rotation-test",
      user: JSON.stringify(user),
    });

    const loginRes = await api.fetch(
      new Request("http://localhost/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      }),
    );

    const setCookie = loginRes.headers.get("Set-Cookie")!;
    const refreshTokenMatch = setCookie.match(/refreshToken=([^;]+)/);
    expect(refreshTokenMatch).not.toBeNull();
    const refreshToken = refreshTokenMatch![1];

    // First refresh — should succeed
    const firstRefresh = await api.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: `refreshToken=${refreshToken}` },
      }),
    );
    expect(firstRefresh.status).toBe(200);

    // Second refresh with same token — should fail (rotated)
    const secondRefresh = await api.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: `refreshToken=${refreshToken}` },
      }),
    );
    expect(secondRefresh.status).toBe(401);
  });
});
