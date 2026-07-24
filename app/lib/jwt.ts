import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { loadConfig } from "../config";

// ---------------------------------------------------------------------------
// Lazy-initialized secret — avoids eager config loading at import time
// so tests can set JWT_SECRET before the first token operation.
// ---------------------------------------------------------------------------

let _secret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (!_secret) {
    const config = loadConfig();
    _secret = new TextEncoder().encode(config.jwtSecret);
  }
  return _secret;
}

/** Reset cached secret (for test isolation). */
export function __resetSecret(): void {
  _secret = null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenPayload extends JWTPayload {
  sub: string;
}

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/** 15-minute access token signed with HS256. */
export async function generateAccessToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

/** 30-day refresh token signed with HS256. */
export async function generateRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/** Verify and decode an access token. Throws on invalid/expired signature. */
export async function verifyAccessToken(
  token: string,
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ["HS256"],
  });
  return payload as TokenPayload;
}

/** Verify and decode a refresh token. Throws on invalid/expired signature. */
export async function verifyRefreshToken(
  token: string,
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecret(), {
    algorithms: ["HS256"],
  });
  return payload as TokenPayload;
}
