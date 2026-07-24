import { cors as honoCors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

export function createCorsMiddleware(): MiddlewareHandler {
  const origin = process.env["ALLOWED_ORIGIN"] ?? "*";
  if (origin === "*") {
    console.warn(
      "[cors] ALLOWED_ORIGIN=* — cookie-based refresh will not work cross-origin. " +
      "Set ALLOWED_ORIGIN to your frontend domain in production.",
    );
  }
  return honoCors({ origin, credentials: origin !== "*" });
}
