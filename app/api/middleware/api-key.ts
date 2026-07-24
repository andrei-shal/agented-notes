import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";

/**
 * Creates a Hono middleware that validates the `X-API-Key` header against the
 * supplied API key using timing-safe comparison.
 *
 * Returns 403 if the key is missing or wrong, or 500 if no key was configured.
 */
export function apiKeyMiddleware(apiKey: string): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) {
      return c.json({ error: "MCP API key not configured" }, 500);
    }

    const headerKey = c.req.header("x-api-key");
    if (!headerKey) {
      return c.json({ error: "Forbidden" }, 403);
    }

    const keyBuf = Buffer.from(apiKey);
    const headerBuf = Buffer.from(headerKey);

    if (
      keyBuf.length !== headerBuf.length ||
      !timingSafeEqual(keyBuf, headerBuf)
    ) {
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}
