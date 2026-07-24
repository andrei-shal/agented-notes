import type { Context } from "hono";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { loadConfig } from "../config";
import { db } from "../db/db";
import { users, refreshTokens } from "../db/schema";
import { validateTelegramInitData } from "../lib/telegram";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from "../lib/jwt";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal cookie-header parser. */
function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    result[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
  }
  return result;
}

const REFRESH_COOKIE_OPTS =
  "HttpOnly; Secure; Path=/api/auth; SameSite=Strict";

function setRefreshCookie(c: Context, token: string): void {
  c.header(
    "Set-Cookie",
    `refreshToken=${token}; ${REFRESH_COOKIE_OPTS}; Max-Age=${30 * 86400}`,
  );
}

function clearRefreshCookie(c: Context): void {
  c.header(
    "Set-Cookie",
    `refreshToken=; ${REFRESH_COOKIE_OPTS}; Max-Age=0`,
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const authRouter = new Hono();

// ── POST /api/auth/telegram ──────────────────────────────────────────

authRouter.post("/telegram", async (c) => {
  const config = loadConfig();

  const body = await c.req.json<{ initData?: string }>().catch(() => ({ initData: undefined }));
  const initData = body.initData;

  if (!initData || typeof initData !== "string") {
    return c.json({ error: "Missing initData in request body" }, 400);
  }

  // Validate Telegram initData
  let parsed;
  try {
    parsed = validateTelegramInitData(initData, config.telegramBotToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid initData";
    return c.json({ error: message }, 401);
  }

  if (!parsed.user?.id) {
    return c.json({ error: "Missing user data in initData" }, 400);
  }

  // ── Find or create user ──────────────────────────────────────────
  const telegramId = parsed.user.id;

  let user = db
    .select()
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .get();

  if (!user) {
    db.insert(users)
      .values({
        telegramId,
        username: parsed.user.username ?? null,
      })
      .run();

    user = db
      .select()
      .from(users)
      .where(eq(users.telegramId, telegramId))
      .get()!;
  }

  // ── Issue token pair ─────────────────────────────────────────────
  const accessToken = await generateAccessToken(user.id);
  const refreshToken = await generateRefreshToken(user.id);

  setRefreshCookie(c, refreshToken);

  return c.json({ accessToken });
});

// ── POST /api/auth/refresh ───────────────────────────────────────────

authRouter.post("/refresh", async (c) => {
  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) {
    return c.json({ error: "Missing refresh token" }, 401);
  }

  const cookies = parseCookieHeader(cookieHeader);
  const refreshToken = cookies["refreshToken"];
  if (!refreshToken) {
    return c.json({ error: "Missing refresh token" }, 401);
  }

  // Verify JWT
  let payload;
  try {
    payload = await verifyRefreshToken(refreshToken);
  } catch {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  // Hash token and check blacklist
  const tokenHash = createHash("sha256").update(refreshToken).digest("hex");

  const blacklisted = db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .get();

  if (blacklisted) {
    return c.json({ error: "Refresh token has been revoked" }, 401);
  }

  // Rotate: blacklist old token
  const expiresAt = payload.exp
    ? new Date(payload.exp * 1000).toISOString()
    : new Date(Date.now() + 30 * 86400 * 1000).toISOString();

  db.insert(refreshTokens)
    .values({ tokenHash, userId: payload.sub, expiresAt })
    .run();

  // Issue new pair
  const newAccessToken = await generateAccessToken(payload.sub);
  const newRefreshToken = await generateRefreshToken(payload.sub);

  setRefreshCookie(c, newRefreshToken);

  return c.json({ accessToken: newAccessToken });
});

// ── POST /api/auth/logout ────────────────────────────────────────────

authRouter.post("/logout", async (c) => {
  const cookieHeader = c.req.header("Cookie");
  if (!cookieHeader) {
    return c.json({ message: "Already logged out" });
  }

  const cookies = parseCookieHeader(cookieHeader);
  const refreshToken = cookies["refreshToken"];
  if (!refreshToken) {
    return c.json({ message: "Already logged out" });
  }

  // Decode token to extract userId and expiration for the blacklist entry
  let userId: string | undefined;
  let expSeconds: number | undefined;

  try {
    const payload = await verifyRefreshToken(refreshToken);
    userId = payload.sub;
    expSeconds = payload.exp;
  } catch {
    // Token might already be expired — still blacklist the hash
  }

  const tokenHash = createHash("sha256").update(refreshToken).digest("hex");

  const expiresAt = expSeconds
    ? new Date(expSeconds * 1000).toISOString()
    : new Date(Date.now() + 30 * 86400 * 1000).toISOString();

  db.insert(refreshTokens)
    .values({ tokenHash, userId: userId ?? null, expiresAt })
    .run();

  clearRefreshCookie(c);

  return c.json({ message: "Logged out" });
});
