/**
 * Search tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - search_people: Search people by name, email, company, or job title.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as operations from "@/lib/leads/operations";
import type { PersonSearchResult } from "@/lib/leads/operations";

/**
 * Format a list of people as a markdown table.
 */
function formatPeopleTable(
  people: Array<PersonSearchResult>,
): string {
  if (people.length === 0) {
    return "_No results_";
  }

  const header = "| Name | Email | Company | Title | Status | Vertical |";
  const divider = "|------|-------|---------|-------|--------|----------|";
  const rows = people.map((p) => {
    const name =
      [p.firstName, p.lastName].filter(Boolean).join(" ") || "_Unknown_";
    const company = p.company ?? "_—_";
    const title = p.jobTitle ?? "_—_";
    const vertical = p.vertical ?? "_—_";
    // Escape pipe characters to avoid breaking markdown table
    const escape = (s: string) => s.replace(/\|/g, "\\|");
    return `| ${escape(name)} | ${escape(p.email)} | ${escape(company)} | ${escape(title)} | ${escape(p.status)} | ${escape(vertical)} |`;
  });

  return [header, divider, ...rows].join("\n");
}

export function registerSearchTools(server: McpServer): void {
  server.tool(
    "search_people",
    "Search people by name, email, company, or job title. Returns paginated table with enrichment status.",
    {
      query: z.string().describe("Search query (name, email, company, or job title)"),
      workspace: z.string().optional().describe("Filter to people in this workspace slug"),
      vertical: z.string().optional().describe("Filter by vertical/industry"),
      status: z.string().optional().describe("Filter by status (new, contacted, replied, interested, bounced, unsubscribed)"),
      limit: z.number().default(25).describe("Number of results per page"),
      offset: z.number().default(0).describe("Pagination offset"),
    },
    async (params) => {
      const { query, workspace, vertical, status, limit, offset } = params;

      const result = await operations.searchPeople({
        query,
        workspaceSlug: workspace,
        vertical,
        limit,
        page: Math.floor(offset / limit) + 1,
      });

      // Status filter: operations.searchPeople does not support status filter.
      // Apply post-filter when status is provided.
      let people = result.people;
      let total = result.total;
      if (status) {
        people = people.filter(p => p.status === status);
        // Note: total count may be inaccurate when post-filtering.
        // This is acceptable — full status support in operations is deferred.
        total = people.length;
      }

      const table = formatPeopleTable(people);
      const rangeStart = total === 0 ? 0 : offset + 1;
      const rangeEnd = offset + people.length;
      const text = `${total} results (showing ${rangeStart}-${rangeEnd})\n\n${table}`;

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
