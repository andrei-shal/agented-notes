import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "../node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from "../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js";
import { tools } from "./tools/index";

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------

/**
 * Creates the MCP server, registers the tool-list and tool-call request
 * handlers, and returns the unconnected `Server` instance.
 *
 * Callers must `.connect(transport)` before the server can handle messages.
 */
export function createMcpServer(): Server {
  const server = new Server(
    { name: "agented-notes-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // -- tools/list ----------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.definition),
  }));

  // -- tools/call ----------------------------------------------------------
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.definition.name === request.params.name);
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`,
      );
    }

    try {
      return await tool.handler(request.params.arguments ?? {});
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

// ---------------------------------------------------------------------------
// Transport factories
// ---------------------------------------------------------------------------

/** Creates an MCP stdio transport (reads stdin, writes stdout). */
export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}

/** Creates a Streamable HTTP transport compatible with Web-standard runtimes. */
export function createHttpTransport(): WebStandardStreamableHTTPServerTransport {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
}
