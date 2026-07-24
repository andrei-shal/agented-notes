import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";

/**
 * A registered MCP tool — combines the JSON Schema definition returned via
 * `tools/list` with the handler that executes `tools/call` invocations.
 */
export interface McpTool {
  definition: Tool;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * Central tool registry.
 *
 * Individual tool modules (`app/mcp/tools/*.ts`) push their tools here.
 * The `server.ts` module reads this array via `tools/index.ts` to
 * register request handlers.
 *
 * This module lives in its own file to avoid circular-dependency issues:
 * tool modules import from here, and `index.ts` re-exports the same
 * bindings — there is no cycle.
 */
export const tools: McpTool[] = [];
