/**
 * Workspace configuration tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - set_workspace_prompt: Set an AI prompt override for a workspace.
 *   - get_workspace_prompts: View all AI prompt overrides for a workspace.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";

/** Map prompt_type enum values to Workspace column names. */
const PROMPT_TYPE_TO_COLUMN = {
  icp_criteria: "icpCriteriaPrompt",
  normalization: "normalizationPrompt",
  outreach_tone: "outreachTonePrompt",
} as const;

type PromptType = keyof typeof PROMPT_TYPE_TO_COLUMN;

export function registerWorkspaceTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // set_workspace_prompt
  // ---------------------------------------------------------------------------
  server.tool(
    "set_workspace_prompt",
    "Set an AI prompt override for a workspace. Types: icp_criteria (ICP scoring criteria), normalization (field normalization rules), outreach_tone (email writing tone).",
    {
      workspace: z.string().describe("Workspace slug"),
      prompt_type: z
        .enum(["icp_criteria", "normalization", "outreach_tone"])
        .describe("Which prompt to set"),
      prompt_text: z.string().describe("The prompt text to set"),
    },
    async (params) => {
      const { workspace, prompt_type, prompt_text } = params;

      const columnName = PROMPT_TYPE_TO_COLUMN[prompt_type as PromptType];

      await prisma.workspace.update({
        where: { slug: workspace },
        data: { [columnName]: prompt_text },
      });

      const text = [
        `Updated ${prompt_type} prompt for workspace '${workspace}'.`,
        "",
        "Current prompt:",
        prompt_text,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // get_workspace_prompts
  // ---------------------------------------------------------------------------
  server.tool(
    "get_workspace_prompts",
    "View all AI prompt overrides configured for a workspace.",
    {
      workspace: z.string().describe("Workspace slug"),
    },
    async (params) => {
      const { workspace } = params;

      const ws = await prisma.workspace.findUniqueOrThrow({
        where: { slug: workspace },
        select: {
          name: true,
          icpCriteriaPrompt: true,
          normalizationPrompt: true,
          outreachTonePrompt: true,
        },
      });

      const format = (label: string, value: string | null) => {
        return `### ${label}\n${value ?? "_Not set_"}`;
      };

      const text = [
        `## AI Prompts for workspace '${workspace}' (${ws.name})`,
        "",
        format("ICP Criteria Prompt (icp_criteria)", ws.icpCriteriaPrompt),
        "",
        format("Normalization Prompt (normalization)", ws.normalizationPrompt),
        "",
        format("Outreach Tone Prompt (outreach_tone)", ws.outreachTonePrompt),
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
