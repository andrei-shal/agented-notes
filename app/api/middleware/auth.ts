import type { MiddlewareHandler } from "hono";
import { verifyAccessToken } from "../../lib/jwt";

export const auth: MiddlewareHandler = async (c, next) => {
  if (c.req.path.startsWith("/api/auth/")) {
    await next();
    return;
  }

  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = header.slice(7).trim();
  if (!token) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  try {
    const payload = await verifyAccessToken(token);
    c.set("userId", payload.sub);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
};
