import { Hono } from "hono";
import { ZodError } from "zod";
import { loadConfig, type Config } from "./config";
import {
  createMcpServer,
  createStdioTransport,
  createHttpTransport,
} from "./mcp/server";
import { apiKeyMiddleware } from "./api/middleware/api-key";
import { AppError } from "./lib/errors";
import { closeDb } from "./db/db";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const config: Config = loadConfig();

console.log(`[startup]  agented-notes v0.1.0`);
console.log(`[startup]  MCP mode: ${config.mcpMode}`);

// ---------------------------------------------------------------------------
// MCP server (runs before HTTP so connection errors surface early)
// ---------------------------------------------------------------------------

if (config.mcpMode === "stdio") {
  const server = createMcpServer();
  await server.connect(createStdioTransport());
  console.log(`[startup]  HTTP server disabled (MCP stdio transport)`);
}

// ---------------------------------------------------------------------------
// Hono application
// ---------------------------------------------------------------------------

import { api } from "./api";

const app = new Hono();

// ── Global error handler ─────────────────────────────────────────────

app.onError((err, c) => {
  console.error(`[error]  ${err.message}`, err.stack ?? "");

  if (err instanceof ZodError) {
    return c.json(
      {
        error: "Validation failed",
        code: "VALIDATION_ERROR",
        details: err.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      },
      400,
    );
  }

  if (err instanceof AppError) {
    return c.json({ error: err.message, code: err.code }, err.statusCode);
  }

  return c.json(
    { error: "Internal server error", code: "INTERNAL_ERROR" },
    500,
  );
});

// ── 404 handler ──────────────────────────────────────────────────────

app.notFound((c) =>
  c.json({ error: `Route not found: ${c.req.method} ${c.req.path}`, code: "NOT_FOUND" }, 404),
);

// ── Routes ───────────────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));

// Mount all /api/* routes (auth, notes, kanban, events, etc.)
app.route("/", api);

if (config.mcpMode === "http") {
  const server = createMcpServer();
  const transport = createHttpTransport();
  await server.connect(transport);

  app.all("/mcp", apiKeyMiddleware(config.mcpApiKey!), async (c) =>
    transport.handleRequest(c.req.raw),
  );

  console.log(`[startup]  MCP endpoint mounted at /mcp`);
}

// ---------------------------------------------------------------------------
// HTTP server (explicit Bun.serve so we can close it on shutdown)
// ---------------------------------------------------------------------------

function startServer(): void {
  if (config.mcpMode === "stdio") {
    // No HTTP server in stdio mode
    return;
  }

  const bunServer = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });

  console.log(`[startup]  HTTP server listening on port ${config.port}`);

  // ── Graceful shutdown ─────────────────────────────────────────────

  function shutdown(signal: string): void {
    console.log(`[shutdown]  Received ${signal}, shutting down gracefully...`);

    // Stop accepting new requests
    bunServer.stop();

    // Close MCP transport if in HTTP mode
    // (stdio transport closes automatically when the process exits)

    // Close SQLite
    closeDb();

    console.log(`[shutdown]  Goodbye.`);
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer();
