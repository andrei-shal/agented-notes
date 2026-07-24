import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, parseArgs } from "../config";

// ---------------------------------------------------------------------------
// Env helpers — isolate the five env vars our config cares about
// ---------------------------------------------------------------------------

const CONFIG_ENV_KEYS = [
  "PORT",
  "JWT_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "MCP_API_KEY",
  "DATABASE_PATH",
] as const;

const savedEnv = new Map<string, string | undefined>();

function saveEnv(): void {
  savedEnv.clear();
  for (const key of CONFIG_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
}

function restoreEnv(): void {
  for (const key of CONFIG_ENV_KEYS) {
    const val = savedEnv.get(key);
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

function setEnv(env: Partial<Record<(typeof CONFIG_ENV_KEYS)[number], string>>): void {
  for (const [key, val] of Object.entries(env)) {
    if (val === undefined || val === null) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
}

function unsetAllEnv(): void {
  for (const key of CONFIG_ENV_KEYS) {
    delete process.env[key];
  }
}

// Provide the three required values so loadConfig doesn't blow up
const REQUIRED_ENV = {
  JWT_SECRET: "test-jwt-secret-16ch",
  TELEGRAM_BOT_TOKEN: "test-telegram-bot-token",
  MCP_API_KEY: "test-mcp-api-key",
};

// ---------------------------------------------------------------------------
// parseArgs — pure function, no env isolation needed
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("returns empty object for no arguments", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("parses --port <number>", () => {
    expect(parseArgs(["--port", "4000"])).toEqual({ port: 4000 });
  });

  it("parses --mcp-stdio", () => {
    expect(parseArgs(["--mcp-stdio"])).toEqual({ mcpMode: "stdio" });
  });

  it("parses --mcp", () => {
    expect(parseArgs(["--mcp"])).toEqual({ mcpMode: "http" });
  });

  it("parses --mcp-port <number>", () => {
    expect(parseArgs(["--mcp-port", "3200"])).toEqual({ mcpPort: 3200 });
  });

  it("parses all flags together", () => {
    expect(parseArgs(["--port", "5000", "--mcp", "--mcp-port", "3300"])).toEqual({
      port: 5000,
      mcpMode: "http",
      mcpPort: 3300,
    });
  });

  it("parses --mcp-stdio alongside --port", () => {
    expect(parseArgs(["--port", "2500", "--mcp-stdio"])).toEqual({
      port: 2500,
      mcpMode: "stdio",
    });
  });

  it("throws when --port has no value", () => {
    expect(() => parseArgs(["--port"])).toThrow(
      "--port requires a number argument",
    );
  });

  it("throws when --mcp-port has no value", () => {
    expect(() => parseArgs(["--mcp-port"])).toThrow(
      "--mcp-port requires a number argument",
    );
  });

  it("ignores unknown flags", () => {
    expect(parseArgs(["--unknown", "--port", "3000"])).toEqual({ port: 3000 });
  });
});

// ---------------------------------------------------------------------------
// loadConfig — full integration tests
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  beforeEach(() => {
    saveEnv();
    // Seed required env vars so tests don't fail on missing required fields
    setEnv(REQUIRED_ENV);
  });

  afterEach(() => {
    restoreEnv();
  });

  // -- defaults -----------------------------------------------------------

  it("uses default values when only required env vars are provided", () => {
    const config = loadConfig([]);

    expect(config.port).toBe(3000);
    expect(config.jwtSecret).toBe("test-jwt-secret-16ch");
    expect(config.telegramBotToken).toBe("test-telegram-bot-token");
    expect(config.mcpApiKey).toBe("test-mcp-api-key");
    expect(config.databasePath).toBe("./data/notes.db");
    expect(config.mcpMode).toBe("none");
    expect(config.mcpMode).toBe("none");
    expect(config.mcpPort).toBe(3100);
  });

  // -- CLI args -----------------------------------------------------------

  it("CLI --port overrides default and env", () => {
    setEnv({ PORT: "5000" });
    const config = loadConfig(["--port", "8080"]);
    expect(config.port).toBe(8080);
  });

  it("CLI --mcp-stdio overrides default mcpMode", () => {
    const config = loadConfig(["--mcp-stdio"]);
    expect(config.mcpMode).toBe("stdio");
  });

  it("CLI --mcp sets mcpMode to http", () => {
    const config = loadConfig(["--mcp"]);
    expect(config.mcpMode).toBe("http");
  });

  it("CLI --mcp-port overrides default mcpPort", () => {
    const config = loadConfig(["--mcp-port", "4200"]);
    expect(config.mcpPort).toBe(4200);
  });

  it("CLI args override env vars", () => {
    setEnv({ PORT: "4000", MCP_API_KEY: "env-key-override-test" });
    const config = loadConfig(["--port", "9000"]);
    expect(config.port).toBe(9000);
    expect(config.mcpApiKey).toBe("env-key-override-test");
  });

  // -- --mcp-stdio vs --mcp conflict -------------------------------------

  it("--mcp-stdio wins when both --mcp and --mcp-stdio are passed (order: --mcp first)", () => {
    const config = loadConfig(["--mcp", "--mcp-stdio"]);
    expect(config.mcpMode).toBe("stdio");
  });

  it("--mcp-stdio wins when both are passed (order: --mcp-stdio first)", () => {
    const config = loadConfig(["--mcp-stdio", "--mcp"]);
    expect(config.mcpMode).toBe("stdio");
  });

  // -- ENV vars -----------------------------------------------------------

  it("loads PORT from env", () => {
    setEnv({ PORT: "4500" });
    const config = loadConfig([]);
    expect(config.port).toBe(4500);
  });

  it("loads DATABASE_PATH from env", () => {
    setEnv({ DATABASE_PATH: "/custom/path/db.sqlite" });
    const config = loadConfig([]);
    expect(config.databasePath).toBe("/custom/path/db.sqlite");
  });

  it("env vars do not override explicit CLI args", () => {
    setEnv({ PORT: "2000" });
    const config = loadConfig(["--port", "5500"]);
    expect(config.port).toBe(5500);
  });

  // -- Modes --------------------------------------------------------------

  it("mcpMode defaults to 'none'", () => {
    const config = loadConfig([]);
    expect(config.mcpMode).toBe("none");
  });

  it("mcpMode is 'stdio' after --mcp-stdio", () => {
    const config = loadConfig(["--mcp-stdio"]);
    expect(config.mcpMode).toBe("stdio");
  });

  it("mcpMode is 'http' after --mcp", () => {
    const config = loadConfig(["--mcp"]);
    expect(config.mcpMode).toBe("http");
  });

  // -- Validation errors --------------------------------------------------

  it("throws when JWT_SECRET is missing", () => {
    unsetAllEnv();
    // Provide other required fields but not JWT_SECRET
    setEnv({ TELEGRAM_BOT_TOKEN: "tok", MCP_API_KEY: "key" });
    expect(() => loadConfig([])).toThrow("jwtSecret");
  });

  it("throws when JWT_SECRET is shorter than 16 characters", () => {
    setEnv({ JWT_SECRET: "short" });
    expect(() => loadConfig([])).toThrow("at least 16 characters");
  });

  it("throws when TELEGRAM_BOT_TOKEN is missing", () => {
    unsetAllEnv();
    setEnv({ JWT_SECRET: "test-jwt-secret-16ch", MCP_API_KEY: "key" });
    expect(() => loadConfig([])).toThrow("telegramBotToken");
  });

  it("throws when MCP_API_KEY is missing and MCP HTTP mode is enabled", () => {
    unsetAllEnv();
    setEnv({ JWT_SECRET: "test-jwt-secret-16ch", TELEGRAM_BOT_TOKEN: "tok" });
    expect(() => loadConfig(["--mcp"])).toThrow("MCP_API_KEY");
  });

  it("does not throw when MCP_API_KEY is missing and MCP is disabled", () => {
    unsetAllEnv();
    setEnv({ JWT_SECRET: "test-jwt-secret-16ch", TELEGRAM_BOT_TOKEN: "tok" });
    expect(() => loadConfig([])).not.toThrow();
  });

  it("throws when port is below 1024", () => {
    setEnv({ PORT: "512" });
    expect(() => loadConfig([])).toThrow("1024");
  });

  it("throws when port is above 65535", () => {
    setEnv({ PORT: "70000" });
    expect(() => loadConfig([])).toThrow("65535");
  });

  it("throws when mcpPort is below 1024", () => {
    expect(() => loadConfig(["--mcp-port", "100"])).toThrow("1024");
  });

  it("throws when mcpPort is above 65535", () => {
    expect(() => loadConfig(["--mcp-port", "99999"])).toThrow("65535");
  });

  it("throws with descriptive error messages containing field name", () => {
    unsetAllEnv();
    setEnv({ JWT_SECRET: "x".repeat(16) }); // valid
    // Missing TELEGRAM_BOT_TOKEN (MCP_API_KEY is now optional)
    try {
      loadConfig([]);
      // Should not reach here
      expect(true).toBe(false);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("telegramBotToken");
      expect(msg).not.toContain("mcpApiKey"); // no longer required by default
    }
  });
});
