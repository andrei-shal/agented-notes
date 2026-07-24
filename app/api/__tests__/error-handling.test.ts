import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { zodValidator } from "../middleware/validate";
import { __resetRateLimitStore, rateLimit } from "../middleware/rate-limit";

// =============================================================================
// Global error handler (mirrors the one in app/index.ts)
// =============================================================================

function addErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message, code: err.code }, err.statusCode);
    }
    return c.json({ error: "Internal server error", code: "INTERNAL_ERROR" }, 500);
  });

  app.notFound((c) =>
    c.json(
      { error: `Route not found: ${c.req.method} ${c.req.path}`, code: "NOT_FOUND" },
      404,
    ),
  );
}

// =============================================================================
// Test app factory
// =============================================================================

function createTestApp(): Hono {
  const app = new Hono();
  addErrorHandler(app);

  // Route that throws AppError
  app.get("/api/app-error", () => {
    throw new AppError(422, "UNPROCESSABLE", "Something is wrong");
  });

  // Route that throws a generic Error
  app.get("/api/internal-error", () => {
    throw new Error("Unexpected boom");
  });

  // Route with Zod validation
  const loginSchema = z.object({
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  app.post("/api/validate", zodValidator(loginSchema), (c) => {
    const valid = (c as any).get("valid");
    return c.json({ ok: true, data: valid } as any);
  });

  return app;
}

// =============================================================================
// Tests
// =============================================================================

describe("Global error handler", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
  });

  test("returns 404 for unknown routes", async () => {
    const res = await app.fetch(new Request("http://localhost/api/nonexistent"));
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("Route not found");
    expect(body.code).toBe("NOT_FOUND");
  });

  test("returns structured error for AppError", async () => {
    const res = await app.fetch(new Request("http://localhost/api/app-error"));
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toBe("Something is wrong");
    expect(body.code).toBe("UNPROCESSABLE");
  });

  test("returns 500 for unknown errors", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/internal-error"),
    );
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(body.code).toBe("INTERNAL_ERROR");
  });
});

describe("Zod validation middleware", () => {
  let app: Hono;

  beforeEach(() => {
    app = createTestApp();
  });

  test("returns 400 with field-level errors on validation failure", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "bad", password: "short" }),
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toBeDefined();
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThanOrEqual(1);
    expect(body.details[0]).toHaveProperty("field");
    expect(body.details[0]).toHaveProperty("message");
  });

  test("returns 415 for non-JSON content type", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/validate", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      }),
    );

    expect(res.status).toBe(415);
  });

  test("returns 400 for malformed JSON body", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_JSON");
  });

  test("passes valid data through and sets c.var.valid", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "password123",
        }),
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.email).toBe("user@example.com");
  });
});

describe("Rate limiting", () => {
  beforeEach(() => {
    __resetRateLimitStore();
  });

  test("allows up to 10 POST requests to /api/auth/ within a minute", async () => {
    const app = new Hono();
    app.use("*", rateLimit());
    app.post("/api/auth/login", (c) => c.json({ ok: true }));

    for (let i = 0; i < 10; i++) {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/login", { method: "POST" }),
      );
      expect(res.status).toBe(200);
    }
  });

  test("returns 429 when rate limit is exceeded", async () => {
    const app = new Hono();
    app.use("*", rateLimit());
    app.post("/api/auth/login", (c) => c.json({ ok: true }));

    // Exhaust the 10-request allowance
    for (let i = 0; i < 10; i++) {
      await app.fetch(
        new Request("http://localhost/api/auth/login", { method: "POST" }),
      );
    }

    // The 11th request should be blocked
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "POST" }),
    );
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(res.headers.get("Retry-After")).toBeDefined();
  });

  test("does not rate-limit GET requests", async () => {
    const app = new Hono();
    app.use("*", rateLimit());
    app.get("/api/auth/status", (c) => c.json({ ok: true }));

    // GET requests should not count towards the POST limit
    for (let i = 0; i < 20; i++) {
      const res = await app.fetch(
        new Request("http://localhost/api/auth/status", { method: "GET" }),
      );
      expect(res.status).toBe(200);
    }
  });

  test("does not rate-limit non-auth paths", async () => {
    const app = new Hono();
    app.use("*", rateLimit());
    app.post("/api/notes", (c) => c.json({ ok: true }));

    for (let i = 0; i < 20; i++) {
      const res = await app.fetch(
        new Request("http://localhost/api/notes", { method: "POST" }),
      );
      expect(res.status).toBe(200);
    }
  });
});

describe("CORS middleware", () => {
  test("in dev mode allows localhost:5173", async () => {
    process.env["NODE_ENV"] = "development";

    const { createCorsMiddleware } = await import("../middleware/cors");
    const app = new Hono();
    app.use("*", createCorsMiddleware());
    app.get("/api/health", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:5173",
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
  });

  test("in dev mode blocks other origins", async () => {
    process.env["NODE_ENV"] = "development";

    const { createCorsMiddleware } = await import("../middleware/cors");
    const app = new Hono();
    app.use("*", createCorsMiddleware());
    app.get("/api/health", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { Origin: "http://evil.com" },
      }),
    );

    // Access-Control-Allow-Origin should not match evil.com
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "http://evil.com",
    );
  });

  test("in production mode is a no-op", async () => {
    process.env["NODE_ENV"] = "production";

    const { createCorsMiddleware } = await import("../middleware/cors");
    const app = new Hono();
    app.use("*", createCorsMiddleware());
    app.get("/api/health", (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://localhost/api/health", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );

    // No CORS headers should be present
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
