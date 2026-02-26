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
import { registerSearchTools } from "./tools/search.js";
import { registerEnrichTools } from "./tools/enrich.js";
import { registerScoreTools } from "./tools/score.js";
import { registerListTools } from "./tools/lists.js";
import { registerExportTools } from "./tools/export.js";
import { registerStatusTools } from "./tools/status.js";
import { registerWorkspaceTools } from "./tools/workspace.js";

const server = new McpServer({
  name: "outsignal-leads",
  version: "1.0.0",
});

// Register all tool modules
registerSearchTools(server);
registerEnrichTools(server);
registerScoreTools(server);
registerListTools(server);
registerExportTools(server);
registerStatusTools(server);
registerWorkspaceTools(server);

// --- Connect transport ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[outsignal-leads] MCP server connected via stdio — all tools registered");
}

main().catch((err) => {
  console.error("[outsignal-leads] Fatal error:", err);
  process.exit(1);
});
