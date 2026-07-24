import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schema — single source of truth for validation + type inference
// ---------------------------------------------------------------------------

const configSchema = z.object({
  port: z
    .number()
    .int()
    .min(1024, "\"port\" must be between 1024 and 65535")
    .max(65535, "\"port\" must be between 1024 and 65535")
    .default(3000),
  jwtSecret: z
    .string()
    .min(1, "\"jwtSecret\" is required but was not provided")
    .min(16, "\"jwtSecret\" must be at least 16 characters"),
  telegramBotToken: z
    .string()
    .min(1, "\"telegramBotToken\" is required but was not provided"),
  mcpApiKey: z
    .string()
    .min(1, "\"mcpApiKey\" must be at least 1 character")
    .optional(),
  databasePath: z
    .string()
    .default("./data/notes.db"),
  mcpMode: z
    .enum(["stdio", "http", "none"])
    .default("none"),
  mcpPort: z
    .number()
    .int()
    .min(1024, "\"mcpPort\" must be between 1024 and 65535")
    .max(65535, "\"mcpPort\" must be between 1024 and 65535")
    .default(3100),
});

export type Config = z.infer<typeof configSchema>;

// ---------------------------------------------------------------------------
// Internal raw representation (all optional — built from env + CLI)
// ---------------------------------------------------------------------------

interface RawConfig {
  port?: number;
  jwtSecret?: string;
  telegramBotToken?: string;
  mcpApiKey?: string;
  databasePath?: string;
  mcpMode?: "stdio" | "http" | "none";
  mcpPort?: number;
}

// ---------------------------------------------------------------------------
// ENV var reader
// ---------------------------------------------------------------------------

function parseEnv(): RawConfig {
  const config: RawConfig = {};

  if (process.env["PORT"]) {
    config.port = Number(process.env["PORT"]);
  }
  if (process.env["JWT_SECRET"]) {
    config.jwtSecret = process.env["JWT_SECRET"];
  }
  if (process.env["TELEGRAM_BOT_TOKEN"]) {
    config.telegramBotToken = process.env["TELEGRAM_BOT_TOKEN"];
  }
  if (process.env["MCP_API_KEY"]) {
    config.mcpApiKey = process.env["MCP_API_KEY"];
  }
  if (process.env["DATABASE_PATH"]) {
    config.databasePath = process.env["DATABASE_PATH"];
  }

  return config;
}

// ---------------------------------------------------------------------------
// CLI argument parser
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): RawConfig {
  const config: RawConfig = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;

    switch (arg) {
      case "--mcp-stdio":
        config.mcpMode = "stdio";
        break;
      case "--mcp":
        config.mcpMode = "http";
        break;
      case "--mcp-port": {
        const val = argv[++i];
        if (val === undefined) {
          throw new Error("--mcp-port requires a number argument");
        }
        config.mcpPort = Number(val);
        break;
      }
      case "--port": {
        const val = argv[++i];
        if (val === undefined) {
          throw new Error("--port requires a number argument");
        }
        config.port = Number(val);
        break;
      }
      default:
        // Unknown flags are silently ignored for forward compatibility
        break;
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Public API — loadConfig
// ---------------------------------------------------------------------------

/**
 * Load and validate application configuration.
 *
 * Precedence (highest to lowest):
 *  1. CLI arguments (`argv`)
 *  2. Environment variables
 *  3. Schema defaults
 *
 * @param argv - Optional argument array (defaults to `process.argv.slice(2)`).
 *               Pass an explicit array for testability.
 * @returns A fully validated `Config` object.
 * @throws {Error} On validation failure with descriptive messages.
 */
export function loadConfig(argv?: string[]): Config {
  const args = argv ?? process.argv.slice(2);
  const envConfig = parseEnv();
  const cliConfig = parseArgs(args);

  // Merge: ENV as base, CLI on top
  const merged: RawConfig = { ...envConfig, ...cliConfig };

  // --mcp-stdio always wins over --mcp regardless of argument order
  if (args.includes("--mcp-stdio")) {
    merged.mcpMode = "stdio";
  }

  const result = configSchema.safeParse(merged);

  if (!result.success) {
    const messages = result.error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`,
    );
    throw new Error(`Config validation failed:\n${messages.join("\n")}`);
  }

  // MCP_API_KEY is required when HTTP mode is enabled
  if (result.data.mcpMode === "http" && !result.data.mcpApiKey) {
    throw new Error(
      "MCP_API_KEY is required when MCP HTTP mode is enabled (use --mcp flag)",
    );
  }

  return result.data;
}
