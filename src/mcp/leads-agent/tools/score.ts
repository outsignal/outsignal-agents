/**
 * ICP scoring tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - score_person: Score a person's ICP fit for a workspace (0-100).
 *   - batch_score_list: Score all unscored people in a workspace.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { scorePersonIcp, scorePersonIcpBatch } from "@/lib/icp/scorer";
import * as operations from "@/lib/leads/operations";

export function registerScoreTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // score_person
  // ---------------------------------------------------------------------------
  server.tool(
    "score_person",
    "Score a person's ICP fit for a workspace (0-100). Requires workspace to have icpCriteriaPrompt configured.",
    {
      person_id: z.string().describe("Person ID to score"),
      workspace: z.string().describe("Workspace slug to score against"),
      force_recrawl: z
        .boolean()
        .default(false)
        .describe("Force re-crawl of company website (bypasses cache)"),
    },
    async (params) => {
      const { person_id, workspace, force_recrawl } = params;

      try {
        const result = await scorePersonIcp(person_id, workspace, force_recrawl);

        if (result.status === "needs_website") {
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  "ICP status: NEEDS_WEBSITE",
                  `Reasoning: ${result.reasoning}`,
                  "No score was stored. Website crawl data is required before ICP scoring can run.",
                ].join("\n"),
              },
            ],
          };
        }

        const text = [
          `ICP Score: ${result.score}/100`,
          `Confidence: ${result.confidence}`,
          `Reasoning: ${result.reasoning}`,
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[score_person] error:", err);
        return {
          content: [
            { type: "text" as const, text: `Scoring failed: ${msg}` },
          ],
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // batch_score_list
  // ---------------------------------------------------------------------------
  server.tool(
    "batch_score_list",
    "Score all unscored people in a workspace. Call without confirm to see count. Set confirm=true to proceed.",
    {
      workspace: z.string().describe("Workspace slug to score"),
      limit: z
        .number()
        .default(50)
        .describe("Max people to score in this batch"),
      confirm: z
        .boolean()
        .default(false)
        .describe("Set to true to proceed with batch scoring."),
    },
    async (params) => {
      const { workspace, limit, confirm } = params;

      // Find unscored people in this workspace
      const unscoredPws = await operations.getUnscoredInWorkspace(workspace);

      const total = unscoredPws.length;

      if (!confirm) {
        const text = `Found ${total} unscored people in workspace '${workspace}'. Set confirm=true to score up to ${limit}.`;
        return { content: [{ type: "text" as const, text }] };
      }

      // Execute batch scoring (up to limit) using batch API
      const batch = unscoredPws.slice(0, limit);
      const batchPersonIds = batch.map((pw) => pw.person.id);

      const result = await scorePersonIcpBatch(batchPersonIds, workspace);

      const text = [
        `Scored ${result.scored}/${batch.length}.`,
        `Failures: ${result.failed}.`,
        result.skipped > 0 ? `Skipped: ${result.skipped}.` : "",
        total > limit
          ? `\n${total - limit} people remain unscored. Run again to continue.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
