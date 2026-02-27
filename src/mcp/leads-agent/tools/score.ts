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
import { prisma } from "@/lib/db";
import { scorePersonIcp } from "@/lib/icp/scorer";

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

      // SCOPE: batch_score_list operates at workspace level (all unscored people in workspace).
      // This is intentionally NOT backed by operations.ts — operations.scoreList is list-scoped.
      // Workspace-level scoring is out of scope for LEAD-05 (requires Phase 8 campaign entity).
      // The scoring execution itself uses the shared scorePersonIcp function (no divergence there).

      // Find unscored people in this workspace
      const unscoredPws = await prisma.personWorkspace.findMany({
        where: {
          workspace,
          icpScore: null,
        },
        include: {
          person: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      const total = unscoredPws.length;

      if (!confirm) {
        const text = `Found ${total} unscored people in workspace '${workspace}'. Set confirm=true to score up to ${limit}.`;
        return { content: [{ type: "text" as const, text }] };
      }

      // Execute batch scoring (up to limit)
      const batch = unscoredPws.slice(0, limit);
      let successCount = 0;
      let failureCount = 0;
      const scores: number[] = [];

      for (const pw of batch) {
        try {
          const result = await scorePersonIcp(pw.person.id, workspace);
          scores.push(result.score);
          successCount++;
        } catch (err) {
          console.error(
            `[batch_score_list] Failed to score person ${pw.person.id}:`,
            err,
          );
          failureCount++;
        }
      }

      const avgScore =
        scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;

      const text = [
        `Scored ${successCount}/${batch.length}.`,
        `Failures: ${failureCount}.`,
        scores.length > 0 ? `Average score: ${avgScore}/100.` : "No scores recorded.",
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
