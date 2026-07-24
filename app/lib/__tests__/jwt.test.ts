import { describe, it, expect, beforeAll, afterAll } from "bun:test";

const JWT_SECRET = "test-jwt-secret-1234567890!";

describe("jwt", () => {
  let jwt: typeof import("../jwt");
  let jose: typeof import("jose");

  beforeAll(async () => {
    process.env["JWT_SECRET"] = JWT_SECRET;
    process.env["TELEGRAM_BOT_TOKEN"] = "test-telegram-bot-token";
    process.env["MCP_API_KEY"] = "test-mcp-api-key";
    jwt = await import("../jwt");
    jose = await import("jose");
  });

  afterAll(() => {
    jwt.__resetSecret();
  });

  // ── Access token ────────────────────────────────────────────────

  it("generateAccessToken creates a valid JWT", async () => {
    const token = await jwt.generateAccessToken("user-123");
    expect(typeof token).toBe("string");
    // JWT has three dot-separated parts
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifyAccessToken returns correct payload", async () => {
    const token = await jwt.generateAccessToken("user-456");
    const payload = await jwt.verifyAccessToken(token);
    expect(payload.sub).toBe("user-456");
  });

  it("verifyAccessToken rejects token signed with wrong secret", async () => {
    const token = await new jose.SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("wrong-secret-1234567890!!"));

    expect(jwt.verifyAccessToken(token)).rejects.toThrow();
  });

  it("access token expires after configured time", async () => {
    const token = await jwt.generateAccessToken("user-123");
    const payload = await jwt.verifyAccessToken(token);
    expect(payload.exp).toBeDefined();
    // Should expire within ~15 minutes (allow 1 minute skew)
    const now = Math.floor(Date.now() / 1000);
    expect(payload.exp!).toBeLessThan(now + 16 * 60);
    expect(payload.exp!).toBeGreaterThan(now + 14 * 60);
  });

  // ── Refresh token ────────────────────────────────────────────────

  it("generateRefreshToken creates a valid JWT", async () => {
    const token = await jwt.generateRefreshToken("user-789");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("verifyRefreshToken returns correct payload", async () => {
    const token = await jwt.generateRefreshToken("user-789");
    const payload = await jwt.verifyRefreshToken(token);
    expect(payload.sub).toBe("user-789");
  });

  it("verifyRefreshToken rejects token signed with wrong secret", async () => {
    const token = await new jose.SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode("wrong-secret-1234567890!!"));

    expect(jwt.verifyRefreshToken(token)).rejects.toThrow();
  });

  it("refresh token expires after 30 days", async () => {
    const token = await jwt.generateRefreshToken("user-123");
    const payload = await jwt.verifyRefreshToken(token);
    expect(payload.exp).toBeDefined();
    const now = Math.floor(Date.now() / 1000);
    // Should expire in ~30 days (allow 1 hour skew)
    expect(payload.exp!).toBeGreaterThan(now + 29 * 86400);
    expect(payload.exp!).toBeLessThan(now + 31 * 86400);
  });

  // ── Invalid tokens ───────────────────────────────────────────────

  it("verifyAccessToken rejects an expired token", async () => {
    // Create a token that expired 1 minute ago
    const token = await new jose.SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime("-1m")
      .sign(new TextEncoder().encode(JWT_SECRET));

    expect(jwt.verifyAccessToken(token)).rejects.toThrow();
  });

  it("verifyRefreshToken rejects an expired token", async () => {
    const token = await new jose.SignJWT({ sub: "user-123" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime("-1m")
      .sign(new TextEncoder().encode(JWT_SECRET));

    expect(jwt.verifyRefreshToken(token)).rejects.toThrow();
  });

  it("verifyAccessToken rejects malformed token", async () => {
    expect(jwt.verifyAccessToken("not-a-jwt")).rejects.toThrow();
  });

  it("verifyRefreshToken rejects malformed token", async () => {
    expect(jwt.verifyRefreshToken("not-a-jwt")).rejects.toThrow();
  });
});
