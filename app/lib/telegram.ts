import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ParsedInitData {
  authDate: number;
  hash: string;
  user?: TelegramUser;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a raw query string into key-value pairs.
 * Both keys and values are URL-decoded once.
 */
function parseQueryString(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of raw.split("&")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = decodeURIComponent(part.slice(0, eqIdx));
    const value = decodeURIComponent(part.slice(eqIdx + 1));
    params[key] = value;
  }
  return params;
}

/**
 * Compute the HMAC-SHA256 secret key used for Telegram initData validation.
 *
 * secret = HMAC-SHA256("WebAppData", botToken)
 */
function computeSecretKey(botToken: string): Buffer {
  return createHmac("sha256", "WebAppData").update(botToken).digest();
}

/**
 * Build the data-check string from parsed parameters (excluding `hash`).
 * Keys are sorted alphabetically, joined as `key=value` with `\n` separator.
 */
function buildDataCheckString(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "hash")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a Telegram Web App initData string.
 *
 * The initData is expected in RAW query-string format (NOT JSON):
 *   auth_date=<unixtime>&query_id=<id>&hash=<hmac>&user=%7B%22id%22%3A...%7D
 *
 * Steps:
 *  1. Parse the query string
 *  2. Check `auth_date` is not older than 24 hours
 *  3. Sort all keys (excluding `hash`) alphabetically
 *  4. Join as `key=value` with `\n` separator
 *  5. HMAC-SHA256 with key = HMAC-SHA256("WebAppData", botToken)
 *  6. Timing-safe compare with the `hash` parameter
 *
 * @throws {Error} If validation fails (invalid hash, expired, missing fields).
 * @returns Parsed init data including the `user` object if present.
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string,
): ParsedInitData {
  const params = parseQueryString(initData);

  // --- Required fields ---
  const hash = params["hash"];
  if (!hash) throw new Error("Missing 'hash' parameter in initData");

  const authDateStr = params["auth_date"];
  if (!authDateStr) throw new Error("Missing 'auth_date' parameter in initData");

  const authDate = Number(authDateStr);
  if (!Number.isInteger(authDate) || authDate <= 0) {
    throw new Error("Invalid 'auth_date' — must be a positive Unix timestamp");
  }

  // --- Expiration check (24 hours) ---
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 86400) {
    throw new Error("initData expired (auth_date is more than 24 hours old)");
  }

  // --- Compute expected hash ---
  const dataCheckString = buildDataCheckString(params);
  const secretKey = computeSecretKey(botToken);
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest();

  // --- Timing-safe comparison ---
  const expectedHash = Buffer.from(hash, "hex");
  if (
    expectedHash.length !== computedHash.length ||
    !timingSafeEqual(computedHash, expectedHash)
  ) {
    throw new Error("Invalid hash in initData");
  }

  // --- Parse user object (optional) ---
  let user: TelegramUser | undefined;
  if (params["user"]) {
    try {
      user = JSON.parse(params["user"]) as TelegramUser;
    } catch {
      throw new Error("Invalid 'user' JSON in initData");
    }
  }

  // Spreading params first ensures parsed `user` object overrides raw string
  return { ...params, authDate, hash, user } as unknown as ParsedInitData;
}

/**
 * Create a valid initData string for testing purposes.
 *
 * @param botToken - The bot token used to sign.
 * @param data     - Key-value pairs to include (the `hash` key is ignored if
 *                   present — it will be computed and overwritten).
 * @returns A fully formed query string with a valid `hash` parameter.
 */
export function createTestInitData(
  botToken: string,
  data: Record<string, string>,
): string {
  // Remove hash if caller accidentally passed it
  const { hash: _ignored, ...clean } = data;

  // Build the data-check string from sorted keys
  const dataCheckString = buildDataCheckString(clean);

  // Compute HMAC
  const secretKey = computeSecretKey(botToken);
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  // Return as query string
  const entries = Object.entries(clean);
  entries.push(["hash", computedHash]);
  // Sort to produce deterministic output
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
