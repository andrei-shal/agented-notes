import { cors as honoCors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

export function createCorsMiddleware(): MiddlewareHandler {
  const isDev = process.env["NODE_ENV"] === "development";

  if (isDev) {
    return honoCors({
      origin: "http://localhost:5173",
      credentials: true,
    });
  }

  return async (_c, next) => {
    await next();
  };
}
