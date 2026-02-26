/**
 * List management tools for the Outsignal Leads Agent MCP server.
 *
 * Lists are stored as JSON arrays in PersonWorkspace.tags.
 * Each tag is a list name. A person can be in multiple lists within a workspace.
 *
 * Tools registered:
 *   - create_list: Create a named list in a workspace.
 *   - add_to_list: Add people to a named list.
 *   - view_list: View people in a named list with their ICP scores.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Parse a JSON tags string into a string array.
 * Returns empty array on null or parse error.
 */
function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function registerListTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // create_list
  // ---------------------------------------------------------------------------
  server.tool(
    "create_list",
    "Create a named list in a workspace. Lists are tags on PersonWorkspace records — the list exists when at least one person has the tag.",
    {
      name: z.string().describe("Name of the list to create"),
      workspace: z.string().describe("Workspace slug"),
    },
    async (params) => {
      const { name, workspace } = params;

      // Validate workspace exists
      await prisma.workspace.findUniqueOrThrow({ where: { slug: workspace } });

      const text = `List '${name}' ready in workspace '${workspace}'. Use add_to_list to add people.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // add_to_list
  // ---------------------------------------------------------------------------
  server.tool(
    "add_to_list",
    "Add people to a named list in a workspace.",
    {
      list_name: z.string().describe("Name of the list"),
      person_ids: z.array(z.string()).describe("Array of Person IDs to add"),
      workspace: z.string().describe("Workspace slug"),
    },
    async (params) => {
      const { list_name, person_ids, workspace } = params;

      let addedCount = 0;
      const errors: string[] = [];

      for (const personId of person_ids) {
        try {
          const pw = await prisma.personWorkspace.findUnique({
            where: {
              personId_workspace: { personId, workspace },
            },
            select: { id: true, tags: true },
          });

          if (!pw) {
            errors.push(`Person ${personId} not in workspace '${workspace}'`);
            continue;
          }

          const currentTags = parseTags(pw.tags);
          if (!currentTags.includes(list_name)) {
            currentTags.push(list_name);
            await prisma.personWorkspace.update({
              where: { id: pw.id },
              data: { tags: JSON.stringify(currentTags) },
            });
          }
          addedCount++;
        } catch (err) {
          console.error(`[add_to_list] Error for person ${personId}:`, err);
          errors.push(`Person ${personId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      let text = `Added ${addedCount} people to list '${list_name}'.`;
      if (errors.length > 0) {
        text += `\n\nErrors (${errors.length}):\n${errors.join("\n")}`;
      }

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // view_list
  // ---------------------------------------------------------------------------
  server.tool(
    "view_list",
    "View people in a named list with their enrichment status and ICP score.",
    {
      list_name: z.string().describe("Name of the list to view"),
      workspace: z.string().describe("Workspace slug"),
      limit: z.number().default(50).describe("Max people to return"),
    },
    async (params) => {
      const { list_name, workspace, limit } = params;

      // Query PersonWorkspace where workspace matches AND tags contains the list name.
      // tags is stored as a JSON string array, so we match on the JSON string representation.
      const pws = await prisma.personWorkspace.findMany({
        where: {
          workspace,
          tags: { contains: `"${list_name}"` },
        },
        take: limit,
        include: {
          person: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              company: true,
              status: true,
            },
          },
        },
      });

      // Double-check that the tag is actually in the array (contains could match substrings)
      const filtered = pws.filter((pw) => parseTags(pw.tags).includes(list_name));
      const count = filtered.length;

      if (count === 0) {
        const text = `0 people in list '${list_name}'. Use add_to_list to add people.`;
        return { content: [{ type: "text" as const, text }] };
      }

      const header = "| Name | Email | Company | ICP Score | Status |";
      const divider = "|------|-------|---------|-----------|--------|";
      const escape = (s: string) => s.replace(/\|/g, "\\|");
      const rows = filtered.map((pw) => {
        const name =
          [pw.person.firstName, pw.person.lastName].filter(Boolean).join(" ") ||
          "_Unknown_";
        const company = pw.person.company ?? "_—_";
        const score = pw.icpScore !== null ? `${pw.icpScore}/100` : "_—_";
        return `| ${escape(name)} | ${escape(pw.person.email)} | ${escape(company)} | ${score} | ${escape(pw.person.status)} |`;
      });

      const table = [header, divider, ...rows].join("\n");
      const text = `${count} people in list '${list_name}':\n\n${table}`;

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
