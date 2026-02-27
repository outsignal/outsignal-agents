/**
 * List management tools for the Outsignal Leads Agent MCP server.
 *
 * Lists are stored as TargetList + TargetListPerson rows (same model as
 * the Phase 4 UI and Phase 5 export tools).
 *
 * Tools registered:
 *   - create_list: Create a named TargetList in a workspace.
 *   - add_to_list: Add people to a TargetList by email address.
 *   - view_list: View people in a TargetList with enrichment summary + export readiness.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getListExportReadiness } from "@/lib/export/verification-gate";
import * as operations from "@/lib/leads/operations";

export function registerListTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // create_list
  // ---------------------------------------------------------------------------
  server.tool(
    "create_list",
    "Create a named TargetList in a workspace. Returns the list ID for use with add_to_list and export tools.",
    {
      name: z.string().describe("Name of the list to create"),
      workspace: z.string().describe("Workspace slug"),
      description: z.string().optional().describe("Optional list description"),
    },
    async (params) => {
      const { name, workspace, description } = params;

      // Validate workspace exists (friendly error, not throw)
      const ws = await prisma.workspace.findUnique({ where: { slug: workspace } });
      if (!ws) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: Workspace '${workspace}' not found. Use a valid workspace slug.`,
            },
          ],
        };
      }

      const list = await operations.createList({
        name,
        workspaceSlug: workspace,
        description,
      });

      const text = [
        `List created successfully.`,
        ``,
        `ID: ${list.id}`,
        `Name: ${list.name}`,
        `Workspace: ${workspace}`,
        `Created: ${list.createdAt.toISOString()}`,
        ``,
        `Use add_to_list with list_id='${list.id}' to add people.`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // add_to_list
  // ---------------------------------------------------------------------------
  server.tool(
    "add_to_list",
    "Add people to a TargetList by email address. Resolves each email to a Person record and creates the list membership. Reports any emails not found in the database.",
    {
      list_id: z.string().describe("TargetList ID (from create_list)"),
      emails: z
        .array(z.string().email())
        .describe("Email addresses of people to add"),
    },
    async (params) => {
      const { list_id, emails } = params;

      // Validate list exists
      const list = await prisma.targetList.findUnique({
        where: { id: list_id },
        select: { id: true, name: true },
      });
      if (!list) {
        return {
          content: [
            { type: "text" as const, text: `Error: TargetList '${list_id}' not found.` },
          ],
        };
      }

      // Resolve all emails to person IDs in parallel (input translation: emails → IDs)
      const resolved = await Promise.all(
        emails.map(async (email) => {
          const person = await prisma.person.findUnique({
            where: { email },
            select: { id: true },
          });
          return { email, personId: person?.id ?? null };
        }),
      );

      const found = resolved.filter(
        (r): r is { email: string; personId: string } => r.personId !== null,
      );
      const notFoundEmails = resolved
        .filter((r) => r.personId === null)
        .map((r) => r.email);

      const result = await operations.addPeopleToList(
        list_id,
        found.map(f => f.personId),
      );

      let text = `Added ${result.added} people to list '${list.name}'.`;
      if (result.alreadyInList > 0) text += ` ${result.alreadyInList} already in list.`;
      if (notFoundEmails.length > 0) {
        text += `\n\nNot found in database (${notFoundEmails.length}):\n${notFoundEmails.join("\n")}`;
      }

      return { content: [{ type: "text" as const, text }] };
    },
  );

  // ---------------------------------------------------------------------------
  // view_list
  // ---------------------------------------------------------------------------
  server.tool(
    "view_list",
    "View a TargetList with enrichment summary, export readiness, and paginated member list. Use offset to paginate through large lists.",
    {
      list_id: z.string().describe("TargetList ID to view"),
      limit: z.number().default(50).describe("Max people to return per page"),
      offset: z.number().default(0).describe("Offset for pagination"),
    },
    async (params) => {
      const { list_id, limit, offset } = params;

      const listDetail = await operations.getList(list_id);
      if (!listDetail) {
        return {
          content: [
            { type: "text" as const, text: `Error: TargetList '${list_id}' not found.` },
          ],
        };
      }

      if (listDetail.peopleCount === 0) {
        const text = `0 people in list '${listDetail.name}'. Use add_to_list to add people.`;
        return { content: [{ type: "text" as const, text }] };
      }

      // Use getListExportReadiness for enrichment/verification data
      // (operations.getList provides member data; readiness provides export-gate metadata)
      const readiness = await getListExportReadiness(list_id);

      // Derive export readiness
      const exportReady =
        readiness.needsVerificationCount === 0 && readiness.blockedCount === 0;
      const unverifiedCount = readiness.needsVerificationCount;

      // Build verification status map from readiness arrays
      const statusMap = new Map<string, "ready" | "unverified" | "blocked">();
      for (const p of readiness.readyPeople) statusMap.set(p.id, "ready");
      for (const p of readiness.needsVerificationPeople) statusMap.set(p.id, "unverified");
      for (const p of readiness.blockedPeople) statusMap.set(p.id, "blocked");

      // Combine all people, apply offset/limit pagination
      const allPeople = [
        ...readiness.readyPeople,
        ...readiness.needsVerificationPeople,
        ...readiness.blockedPeople,
      ];
      const page = allPeople.slice(offset, offset + limit);

      // Build summary header
      const exportReadyStr = exportReady
        ? "Yes"
        : `No — ${unverifiedCount} unverified`;

      const summaryLines = [
        `List: ${listDetail.name} (${listDetail.workspaceSlug})`,
        `Total: ${readiness.totalCount} people`,
        `Export Ready: ${exportReadyStr}`,
        ``,
        `Enrichment Coverage:`,
        `- Company data: ${readiness.enrichmentCoverage.companyDataPct}%`,
        `- LinkedIn: ${readiness.enrichmentCoverage.linkedinPct}%`,
        `- Job title: ${readiness.enrichmentCoverage.jobTitlePct}%`,
        ``,
        `Verification:`,
        `- Ready: ${readiness.readyCount}`,
        `- Needs verification: ${readiness.needsVerificationCount}`,
        `- Blocked: ${readiness.blockedCount}`,
      ];

      // Build member table
      const escape = (s: string) => s.replace(/\|/g, "\\|");
      const header = "| Name | Email | Company | Enrichment | Verification |";
      const divider = "|------|-------|---------|------------|--------------|";

      const rows = page.map((person) => {
        const name =
          [person.firstName, person.lastName].filter(Boolean).join(" ") ||
          "_Unknown_";
        const company = person.company ?? "_—_";
        // Derive enrichment status inline
        const hasLinkedin = !!person.linkedinUrl;
        const hasDomain = !!person.companyDomain;
        const enrichment =
          hasLinkedin && hasDomain
            ? "full"
            : hasLinkedin || hasDomain
              ? "partial"
              : "missing";
        const verification = statusMap.get(person.id) ?? "unverified";
        return `| ${escape(name)} | ${escape(person.email)} | ${escape(company)} | ${enrichment} | ${verification} |`;
      });

      const table = [header, divider, ...rows].join("\n");

      // Pagination footer (only if not showing all)
      const paginationLines: string[] = [];
      if (page.length < readiness.totalCount) {
        paginationLines.push(
          ``,
          `Showing ${offset + 1}-${offset + page.length} of ${readiness.totalCount}`,
        );
      }

      const text = [
        ...summaryLines,
        ``,
        table,
        ...paginationLines,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
