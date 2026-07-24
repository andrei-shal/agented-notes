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

// ── Test database setup ─────────────────────────────────────────────

const TEST_DIR = mkdtempSync(join(tmpdir(), "agented-notes-kanban-api-test-"));
const DB_PATH = join(TEST_DIR, "test.db");

process.env["DATABASE_PATH"] = DB_PATH;
process.env["JWT_SECRET"] = "test-jwt-secret-for-kanban-api-tests-12345";
process.env["TELEGRAM_BOT_TOKEN"] = "1234567890:test-bot-token-for-kanban";
process.env["MCP_API_KEY"] = "test-mcp-api-key-for-kanban";

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

describe("Kanban API", () => {
  let api: Awaited<typeof import("../../api/index")>["api"];
  let token: string;

  beforeAll(async () => {
    const apiModule = await import("../../api/index");
    api = apiModule.api;

    // Reset JWT secret cache so it re-reads from our env
    const jwt = await import("../../lib/jwt");
    jwt.__resetSecret();

    token = await jwt.generateAccessToken("test-user-id");
  });

  afterAll(() => {
    cleanup();
  });

  // ── Helpers ───────────────────────────────────────────────────────

  function authHeaders(headers: Record<string, string> = {}): Record<string, string> {
    return { ...headers, Authorization: `Bearer ${token}` };
  }

  async function request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ) {
    const headers: Record<string, string> = authHeaders({ ...extraHeaders });
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return api.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  }

  // ── Board CRUD ────────────────────────────────────────────────────

  test("POST /api/kanban/boards creates a board with default columns", async () => {
    const res = await request("POST", "/api/kanban/boards", {
      name: "API Test Board",
      description: "Created via API",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe("API Test Board");
    expect(body.columns).toHaveLength(3);
    expect(body.columns[0]!.name).toBe("To Do");
  });

  test("POST /api/kanban/boards returns 400 when name is missing", async () => {
    const res = await request("POST", "/api/kanban/boards", {
      description: "No name",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test("GET /api/kanban/boards lists all boards", async () => {
    const res = await request("GET", "/api/kanban/boards");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // At least 1 board from the create test
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0]!.id).toBeDefined();
    expect(body[0]!.columns).toBeDefined();
    expect(body[0]!.columns[0]!.taskCount).toBeDefined();
  });

  test("GET /api/kanban/boards/:id returns board with columns and tasks", async () => {
    // Create a board first
    const createRes = await request("POST", "/api/kanban/boards", {
      name: "Get Board Detail",
    });
    const created = await createRes.json() as { id: string };

    const res = await request("GET", `/api/kanban/boards/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Get Board Detail");
    expect(body.columns).toHaveLength(3);
    expect(body.columns[0]!.tasks).toEqual([]);
  });

  test("GET /api/kanban/boards/:id returns 404 for non-existent board", async () => {
    const res = await request("GET", "/api/kanban/boards/nonexistent-id");
    expect(res.status).toBe(404);
  });

  test("PUT /api/kanban/boards/:id updates board", async () => {
    const createRes = await request("POST", "/api/kanban/boards", {
      name: "Before Update",
    });
    const created = await createRes.json() as { id: string };

    const res = await request("PUT", `/api/kanban/boards/${created.id}`, {
      name: "After Update",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("After Update");
  });

  test("DELETE /api/kanban/boards/:id deletes board", async () => {
    const createRes = await request("POST", "/api/kanban/boards", {
      name: "Board To Delete",
    });
    const created = await createRes.json() as { id: string };

    const res = await request("DELETE", `/api/kanban/boards/${created.id}`);
    expect(res.status).toBe(200);

    const getRes = await request("GET", `/api/kanban/boards/${created.id}`);
    expect(getRes.status).toBe(404);
  });

  // ── Column operations ─────────────────────────────────────────────

  test("POST /api/kanban/boards/:boardId/columns creates column", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Column Test Board",
    });
    const board = await boardRes.json() as { id: string };

    const res = await request(
      "POST",
      `/api/kanban/boards/${board.id}/columns`,
      { name: "Custom Column", color: "#ff9900" },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Custom Column");
    expect(body.color).toBe("#ff9900");
    expect(body.position).toBe(3);
  });

  test("PUT /api/kanban/columns/:id updates column", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Update Col",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };

    const res = await request("PUT", `/api/kanban/columns/${board.columns[0]!.id}`, {
      name: "Renamed Column",
      color: "#00ff00",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Renamed Column");
    expect(body.color).toBe("#00ff00");
  });

  test("DELETE /api/kanban/columns/:id deletes column", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Delete Col",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };

    const res = await request("DELETE", `/api/kanban/columns/${board.columns[0]!.id}`);
    expect(res.status).toBe(200);

    // Verify the board shows 2 columns left
    const getRes = await request("GET", `/api/kanban/boards/${board.id}`);
    const getBody = await getRes.json() as { columns: unknown[] };
    expect(getBody.columns).toHaveLength(2);
  });

  // ── Task operations ───────────────────────────────────────────────

  test("POST /api/kanban/boards/:boardId/columns/:columnId/tasks creates task", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Task API Test",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };
    const colId = board.columns[0]!.id;

    const res = await request(
      "POST",
      `/api/kanban/boards/${board.id}/columns/${colId}/tasks`,
      { title: "API Task", description: "Via API", tags: ["api"] },
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("API Task");
    expect(body.tags).toEqual(["api"]);
  });

  test("GET /api/kanban/boards/:boardId/columns/:columnId/tasks lists tasks", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "List Tasks API",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };
    const colId = board.columns[0]!.id;

    await request("POST", `/api/kanban/boards/${board.id}/columns/${colId}/tasks`, {
      title: "Task 1",
    });
    await request("POST", `/api/kanban/boards/${board.id}/columns/${colId}/tasks`, {
      title: "Task 2",
    });

    const res = await request(
      "GET",
      `/api/kanban/boards/${board.id}/columns/${colId}/tasks`,
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ title: string }>;
    expect(body).toHaveLength(2);
  });

  test("PUT /api/kanban/tasks/:id updates task", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Update Task API",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };
    const colId = board.columns[0]!.id;

    const createRes = await request(
      "POST",
      `/api/kanban/boards/${board.id}/columns/${colId}/tasks`,
      { title: "Before Update", tags: ["a"] },
    );
    const created = await createRes.json() as { id: string };

    const res = await request("PUT", `/api/kanban/tasks/${created.id}`, {
      title: "After Update",
      tags: ["b"],
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("After Update");
    expect(body.tags).toEqual(["b"]);
  });

  test("PATCH /api/kanban/tasks/:id/move moves task between columns", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Move Task API",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };
    const srcColId = board.columns[0]!.id;
    const dstColId = board.columns[1]!.id;

    const createRes = await request(
      "POST",
      `/api/kanban/boards/${board.id}/columns/${srcColId}/tasks`,
      { title: "Movable Task" },
    );
    const created = await createRes.json() as { id: string };

    const res = await request("PATCH", `/api/kanban/tasks/${created.id}/move`, {
      targetColumnId: dstColId,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columnId).toBe(dstColId);
  });

  test("PATCH /api/kanban/tasks/:id/move returns 400 without targetColumnId", async () => {
    const res = await request("PATCH", "/api/kanban/tasks/some-id/move", {});
    expect(res.status).toBe(400);
  });

  test("DELETE /api/kanban/tasks/:id deletes task", async () => {
    const boardRes = await request("POST", "/api/kanban/boards", {
      name: "Delete Task API",
    });
    const board = await boardRes.json() as { id: string; columns: Array<{ id: string }> };
    const colId = board.columns[0]!.id;

    const createRes = await request(
      "POST",
      `/api/kanban/boards/${board.id}/columns/${colId}/tasks`,
      { title: "Delete Me" },
    );
    const created = await createRes.json() as { id: string };

    const res = await request("DELETE", `/api/kanban/tasks/${created.id}`);
    expect(res.status).toBe(200);

    // Verify it's gone
    const listRes = await request(
      "GET",
      `/api/kanban/boards/${board.id}/columns/${colId}/tasks`,
    );
    const tasks = await listRes.json() as unknown[];
    expect(tasks).toHaveLength(0);
  });

  // ── Auth protection ───────────────────────────────────────────────

  test("kanban endpoints return 401 without auth token", async () => {
    const res = await api.fetch(
      new Request("http://localhost/api/kanban/boards", { method: "GET" }),
    );
    expect(res.status).toBe(401);
  });
});
