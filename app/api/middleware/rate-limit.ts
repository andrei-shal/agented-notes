import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitEntry>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 10;
let requestCount = 0;

/**
 * Middleware that limits POST requests to `/api/auth/*` to 10 requests per
 * minute per IP address.
 *
 * Returns `429 Too Many Requests` with a `Retry-After` header when the limit
 * is exceeded.
 *
 * Expired entries are cleaned up lazily on each request.
 */
export function rateLimit(): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;
    if (method !== "POST" || !path.startsWith("/api/auth/")) {
      await next();
      return;
    }

    const ip = c.req.header("x-forwarded-for")
      ?? c.req.header("x-real-ip")
      ?? "unknown";

    const now = Date.now();

    // Periodic full sweep — every ~20 requests
    requestCount++;
    if (requestCount % 20 === 0) {
      for (const [key, e] of store) {
        if (now > e.resetTime) {
          store.delete(key);
        }
      }
    }

    let entry = store.get(ip);

    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + WINDOW_MS };
      store.set(ip, entry);
    }

    entry.count++;

    if (entry.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return c.json(
        {
          error: "Too many requests. Please try again later.",
          code: "RATE_LIMIT_EXCEEDED",
        },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    await next();
  };
}

/**
 * Reset the rate-limit store (useful in tests).
 */
export function __resetRateLimitStore(): void {
  store.clear();
}
