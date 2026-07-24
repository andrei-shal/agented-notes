import { describe, it, expect, beforeAll } from "bun:test";

const BOT_TOKEN = "1234567890:test-bot-token-abc";

describe("telegram", () => {
  let tg: typeof import("../telegram");

  beforeAll(async () => {
    tg = await import("../telegram");
  });

  // ── createTestInitData ───────────────────────────────────────────

  it("createTestInitData produces a valid query string with hash", () => {
    const data = {
      auth_date: "1234567890",
      query_id: "test-query-id",
      user: JSON.stringify({ id: 123, username: "testuser" }),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    expect(initData).toContain("hash=");
    expect(initData).toContain("auth_date=");
    expect(initData).toContain("query_id=");
    expect(initData).toContain("user=");
  });

  it("createTestInitData encodes values properly", () => {
    const now = Math.floor(Date.now() / 1000);
    const data = {
      auth_date: String(now),
      query_id: "qid/test+user",
      user: JSON.stringify({ id: 1, first_name: "Тест" }),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const parts = initData.split("&");
    expect(parts.every((p) => p.includes("="))).toBe(true);
    expect(initData).toContain("hash=");

    // Verify the created initData validates correctly
    const parsed = tg.validateTelegramInitData(initData, BOT_TOKEN);
    expect(parsed.authDate).toBe(now);
  });

  // ── validateTelegramInitData ─────────────────────────────────────

  it("accepts valid initData", () => {
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
      user: JSON.stringify({ id: 123, username: "testuser" }),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const parsed = tg.validateTelegramInitData(initData, BOT_TOKEN);

    expect(parsed.authDate).toBe(Number(data.auth_date));
    expect(parsed.hash).toBeDefined();
    expect(parsed.user?.id).toBe(123);
    expect(parsed.user?.username).toBe("testuser");
  });

  it("rejects initData with invalid hash", () => {
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
      user: JSON.stringify({ id: 123 }),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const tampered = initData.replace(
      /hash=[a-f0-9]+/,
      "hash=0000000000000000000000000000000000000000000000000000000000000000",
    );

    expect(() => tg.validateTelegramInitData(tampered, BOT_TOKEN)).toThrow(
      "Invalid hash",
    );
  });

  it("rejects expired initData (older than 24 hours)", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 86401; // 24h + 1s

    const data = {
      auth_date: String(oldTimestamp),
      query_id: "test-query-id",
      user: JSON.stringify({ id: 123 }),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    expect(() => tg.validateTelegramInitData(initData, BOT_TOKEN)).toThrow(
      "expired",
    );
  });

  it("rejects initData within 24 hours but with wrong bot token", () => {
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    expect(() =>
      tg.validateTelegramInitData(initData, "wrong-bot-token"),
    ).toThrow("Invalid hash");
  });

  it("rejects initData missing hash", () => {
    expect(() =>
      tg.validateTelegramInitData("auth_date=1000&query_id=abc", BOT_TOKEN),
    ).toThrow("hash");
  });

  it("rejects initData missing auth_date", () => {
    const data = { query_id: "test-query-id" };
    const initData = tg.createTestInitData(BOT_TOKEN, data);
    // Remove auth_date
    const tampered = initData.replace(/auth_date=\d+&?/, "");
    expect(() => tg.validateTelegramInitData(tampered, BOT_TOKEN)).toThrow(
      "auth_date",
    );
  });

  it("parses user JSON from initData", () => {
    const user = { id: 456, first_name: "Test", last_name: "User", username: "tester" };
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
      user: JSON.stringify(user),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const parsed = tg.validateTelegramInitData(initData, BOT_TOKEN);

    expect(parsed.user?.id).toBe(456);
    expect(parsed.user?.first_name).toBe("Test");
    expect(parsed.user?.last_name).toBe("User");
    expect(parsed.user?.username).toBe("tester");
  });

  it("tolerates missing user field", () => {
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const parsed = tg.validateTelegramInitData(initData, BOT_TOKEN);
    expect(parsed.user).toBeUndefined();
  });

  it("rejects malformed user JSON", () => {
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
      user: "not-json",
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    expect(() => tg.validateTelegramInitData(initData, BOT_TOKEN)).toThrow(
      "Invalid 'user' JSON",
    );
  });

  // ── Edge cases ───────────────────────────────────────────────────

  it("handles initData with additional parameters", () => {
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: "test-query-id",
      user: JSON.stringify({ id: 789 }),
      signature: "extra-param",
      platform: "web",
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const parsed = tg.validateTelegramInitData(initData, BOT_TOKEN);
    expect(parsed.user?.id).toBe(789);
  });

  it("validates alpha-sorted keys correctly", () => {
    // Keys that sort before 'auth_date' alphabetically
    const data = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      chat_instance: "abc",
      chat_type: "private",
      query_id: "test-query-id",
      user: JSON.stringify({ id: 111 }),
    };

    const initData = tg.createTestInitData(BOT_TOKEN, data);
    const parsed = tg.validateTelegramInitData(initData, BOT_TOKEN);
    expect(parsed.user?.id).toBe(111);
  });
});
