import { beforeAll, afterAll } from "bun:test";

/**
 * Test helpers for the app.
 *
 * Exports:
 * - createTestApp() — returns a fresh Hono app instance for integration tests
 * - testDb — in-memory SQLite database for test isolation
 * - mockUser — factory for authenticated test requests
 */

// Placeholder implementations — will be fleshed out as tests are written.

beforeAll(() => {
  // e.g. set up in-memory database, env overrides
});

afterAll(() => {
  // e.g. close database connection
});
