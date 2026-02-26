/**
 * Export tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - export_to_emailbison: Export a list to EmailBison after verifying all emails.
 *
 * Hard export gate: ALL emails must have "valid" status before export is allowed.
 * Any email with a non-valid status blocks the entire export.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  verifyEmail,
  getVerificationStatus,
} from "@/lib/verification/leadmagic";

/**
 * Parse a JSON tags string into a string array.
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

export function registerExportTools(server: McpServer): void {
  server.tool(
    "export_to_emailbison",
    "Export a list to EmailBison. Verifies ALL emails first — blocks if any email is not 'valid'. Call without confirm to see pre-export summary.",
    {
      list_name: z.string().describe("Name of the list to export"),
      workspace: z.string().describe("Workspace slug"),
      campaign_id: z
        .string()
        .optional()
        .describe("EmailBison campaign ID (if known)"),
      confirm: z
        .boolean()
        .default(false)
        .describe(
          "Set to true to verify and export. First call without confirm to see summary.",
        ),
    },
    async (params) => {
      const { list_name, workspace, campaign_id, confirm } = params;

      // Find all people in the list (same query as view_list)
      const pws = await prisma.personWorkspace.findMany({
        where: {
          workspace,
          tags: { contains: `"${list_name}"` },
        },
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              company: true,
              jobTitle: true,
              companyDomain: true,
              linkedinUrl: true,
              status: true,
            },
          },
        },
      });

      // Double-check tag membership (contains could match substrings)
      const people = pws
        .filter((pw) => parseTags(pw.tags).includes(list_name))
        .map((pw) => pw.person);

      const total = people.length;

      if (total === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `List '${list_name}' is empty. No people to export.`,
            },
          ],
        };
      }

      if (!confirm) {
        // Pre-export summary: check cached verification status for each person
        let readyCount = 0;
        let needsVerificationCount = 0;
        let blockedCount = 0;

        for (const person of people) {
          const verStatus = await getVerificationStatus(person.id);
          if (verStatus === null) {
            needsVerificationCount++;
          } else if (verStatus.isExportable) {
            readyCount++;
          } else {
            blockedCount++;
          }
        }

        const estimatedCost = (needsVerificationCount * 0.05).toFixed(2);

        const text = [
          `List '${list_name}': ${total} people`,
          `- Ready (verified): ${readyCount}`,
          `- Needs verification: ${needsVerificationCount}`,
          `- Blocked (invalid/catch-all): ${blockedCount}`,
          "",
          `Estimated verification cost: ~$${estimatedCost}`,
          "Set confirm=true to verify and export.",
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      }

      // Verify all unverified emails
      const verificationResults: Map<
        string,
        { status: string; isExportable: boolean }
      > = new Map();

      for (const person of people) {
        const cached = await getVerificationStatus(person.id);
        if (cached !== null) {
          verificationResults.set(person.id, cached);
        } else {
          // Call LeadMagic to verify
          try {
            const result = await verifyEmail(person.email, person.id);
            verificationResults.set(person.id, {
              status: result.status,
              isExportable: result.isExportable,
            });
          } catch (err) {
            console.error(
              `[export_to_emailbison] Failed to verify ${person.email}:`,
              err,
            );
            verificationResults.set(person.id, {
              status: "unknown",
              isExportable: false,
            });
          }
        }
      }

      // Check for any blocked emails
      const blocked = people.filter((p) => {
        const result = verificationResults.get(p.id);
        return !result?.isExportable;
      });

      if (blocked.length > 0) {
        const blockedList = blocked
          .map((p) => {
            const result = verificationResults.get(p.id);
            return `- ${p.email}: ${result?.status ?? "unknown"}`;
          })
          .join("\n");

        const text = [
          `Export blocked: ${blocked.length} emails are not valid.`,
          "",
          blockedList,
          "",
          "Remove blocked people from the list or re-verify.",
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      }

      // All emails valid — generate export data
      const csvHeader = "name,email,company,job_title,linkedin_url,campaign_id";
      const csvRows = people.map((p) => {
        const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
        const campaignValue = campaign_id ?? "";
        // Escape CSV values
        const escape = (s: string | null) => {
          if (!s) return "";
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        };
        return [
          escape(name),
          escape(p.email),
          escape(p.company),
          escape(p.jobTitle),
          escape(p.linkedinUrl),
          escape(campaignValue),
        ].join(",");
      });

      const csvData = [csvHeader, ...csvRows].join("\n");

      const text = [
        `All ${total} emails verified as valid.`,
        `EmailBison push endpoint integration coming in Phase 5.`,
        "",
        "Export data:",
        "```csv",
        csvData,
        "```",
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
