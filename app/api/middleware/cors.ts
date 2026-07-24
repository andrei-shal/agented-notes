import { cors as honoCors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

export function createCorsMiddleware(): MiddlewareHandler {
  const origin = process.env["ALLOWED_ORIGIN"] ?? "*";
  return honoCors({ origin, credentials: origin !== "*" });
}
