/**
 * Outsignal Leads Agent — MCP server for Claude Code.
 * Provides tools for lead search, enrichment, ICP scoring, list building,
 * export, and workspace configuration.
 *
 * CRITICAL: Do NOT use console.log anywhere in this file or imported modules
 * that run in this process. console.log writes to stdout which is reserved
 * for JSON-RPC protocol messages. Use console.error for all logging.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "outsignal-leads",
  version: "1.0.0",
});

// --- Tool registrations will be added in Plan 03-03 ---
// Placeholder: register a ping tool to verify the server starts correctly
server.tool(
  "ping",
  "Health check — returns pong. Use to verify the MCP server is running.",
  {},
  async () => {
    return { content: [{ type: "text" as const, text: "pong" }] };
  }
);

// --- Connect transport ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[outsignal-leads] MCP server connected via stdio");
}

main().catch((err) => {
  console.error("[outsignal-leads] Fatal error:", err);
  process.exit(1);
});
