/**
 * Export tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - export_to_emailbison: Export a TargetList to EmailBison after pre-export summary and verification.
 *   - export_csv: Generate a CSV for a TargetList and optionally write to disk.
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
  getListExportReadiness,
  verifyAndFilter,
} from "@/lib/export/verification-gate";
import { generateListCsv } from "@/lib/export/csv";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export function registerExportTools(server: McpServer): void {
  // ─── Tool 1: export_to_emailbison ───────────────────────────────────────────
  server.tool(
    "export_to_emailbison",
    [
      "Export a TargetList to an EmailBison campaign.",
      "Call without confirm to see a pre-export summary (lead count, verification status, enrichment coverage).",
      "Set verify_unverified=true to verify unverified emails first.",
      "Set confirm=true to execute the push after reviewing the summary.",
    ].join(" "),
    {
      list_id: z.string().describe("TargetList ID to export"),
      workspace: z.string().describe("Workspace slug"),
      template_campaign_id: z
        .number()
        .optional()
        .describe(
          "If provided, duplicate this campaign (inherits email sequence). If omitted, create a new campaign.",
        ),
      confirm: z
        .boolean()
        .default(false)
        .describe(
          "Set true to execute the push after reviewing the pre-export summary.",
        ),
      verify_unverified: z
        .boolean()
        .default(false)
        .describe(
          "Set true to trigger email verification for unverified people before export.",
        ),
    },
    async (params) => {
      const { list_id, workspace, template_campaign_id, confirm, verify_unverified } =
        params;

      // ── Step 1: Look up TargetList ──────────────────────────────────────────
      const list = await prisma.targetList.findUnique({
        where: { id: list_id },
        select: { id: true, name: true },
      });
      if (!list) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: TargetList with ID '${list_id}' not found.`,
            },
          ],
        };
      }

      // ── Step 2: Look up or create Workspace ─────────────────────────────────
      let ws = await prisma.workspace.findUnique({ where: { slug: workspace } });
      let workspaceCreatedMessage = "";
      if (!ws) {
        // LOCKED CONTEXT.md DECISION: Agent creates workspace if it does not exist.
        ws = await prisma.workspace.create({
          data: { slug: workspace, name: workspace },
        });
        workspaceCreatedMessage = `\n> Workspace '${workspace}' was created. Note: You need to configure its apiToken before pushing leads to EmailBison.\n`;
      }

      // ── Step 3: verify_unverified=true → trigger verification ───────────────
      if (verify_unverified) {
        const readiness = await getListExportReadiness(list_id);
        if (readiness.needsVerificationCount === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No unverified emails. Set confirm=true to export.",
              },
            ],
          };
        }

        const { verified, excluded } = await verifyAndFilter(
          readiness.needsVerificationPeople.map((p) => ({
            id: p.id,
            email: p.email,
          })),
        );

        const excludedLines =
          excluded.length > 0
            ? excluded.map((e) => `  - ${e.email}: ${e.status}`).join("\n")
            : "  (none)";

        const updatedCount = readiness.readyCount + verified.length;

        const text = [
          "## Verification Complete",
          "",
          `- Verified as valid: ${verified.length}`,
          `- Excluded (invalid/catch-all): ${excluded.length}`,
          ...(excluded.length > 0 ? [excludedLines] : []),
          "",
          `Updated export count: ${updatedCount} people`,
          "Set confirm=true to push.",
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      }

      // ── Step 4: confirm=true → execute push ─────────────────────────────────
      if (confirm) {
        // SCOPE: The MCP export confirm=true path manages campaigns (create/duplicate) and
        // custom variables (linkedin_url). Campaign management is out of scope for LEAD-05 —
        // operations.exportListToEmailBison handles lead upload only. Campaign-aware export
        // will be unified when the Campaign entity is added in Phase 8.
        // The lead upload loop is structurally identical; linkedin_url custom var is MCP-only.

        // Fresh readiness check after potential verification
        const readiness = await getListExportReadiness(list_id);

        if (readiness.needsVerificationCount > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Export blocked: ${readiness.needsVerificationCount} emails still unverified. Set verify_unverified=true first.`,
              },
            ],
          };
        }

        const exportable = readiness.readyPeople;
        if (exportable.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No exportable leads in this list.",
              },
            ],
          };
        }

        // Re-fetch workspace to get apiToken
        const wsWithToken = await prisma.workspace.findUnique({
          where: { slug: workspace },
        });
        if (!wsWithToken?.apiToken) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Workspace has no EmailBison API token. Configure it before pushing.`,
              },
            ],
          };
        }

        const client = new EmailBisonClient(wsWithToken.apiToken);

        // Generate campaign name: workspace_list_date (underscores)
        const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const safeName = (s: string) => s.replace(/\s+/g, "_");
        const campaignName = `${safeName(ws.name)}_${safeName(list.name)}_${dateStr}`;

        // Create or duplicate campaign
        const campaign = template_campaign_id
          ? await client.duplicateCampaign(template_campaign_id)
          : await client.createCampaign({ name: campaignName });

        // Ensure custom variables exist before pushing leads
        await client.ensureCustomVariables(["linkedin_url"]);

        // Push each lead individually
        let successCount = 0;
        let failCount = 0;
        for (const person of exportable) {
          try {
            await client.createLead({
              firstName: person.firstName ?? undefined,
              lastName: person.lastName ?? undefined,
              email: person.email,
              jobTitle: person.jobTitle ?? undefined,
              company: person.company ?? undefined,
              phone: person.phone ?? undefined,
              customVariables: person.linkedinUrl
                ? [{ name: "linkedin_url", value: person.linkedinUrl }]
                : undefined,
            });
            successCount++;
          } catch (err) {
            console.error(
              `[export_to_emailbison] Failed to push lead ${person.email}:`,
              err,
            );
            failCount++;
          }
        }

        const totalExportable = exportable.length;
        const campaignNote = template_campaign_id
          ? `Note: Campaign was duplicated from #${template_campaign_id} — email sequence inherited.`
          : "Note: Campaign was created fresh — you need to set up the email sequence.";

        const lines = [
          "## Export Complete",
          "",
          `**Campaign:** ${campaign.name} (ID: ${campaign.id})`,
          `**Leads pushed:** ${successCount}/${totalExportable}`,
          ...(failCount > 0 ? [`**Failed:** ${failCount} (see server logs)`] : []),
          "",
          "### Next Steps",
          "1. Go to EmailBison: https://app.outsignal.ai",
          `2. Open campaign "${campaign.name}"`,
          `3. Import the ${successCount} leads from the workspace lead pool into this campaign`,
          "4. Configure email sequence (if new campaign) or verify sequence (if duplicated)",
          "5. Activate campaign when ready",
          "",
          campaignNote,
        ];

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      }

      // ── Step 5: Default (confirm=false, verify_unverified=false) → summary ──
      if (ws.apiToken == null || ws.apiToken === "") {
        const infoText = [
          workspaceCreatedMessage,
          `Workspace '${ws.name}' has no EmailBison API token configured. Set the apiToken in the database before pushing leads.`,
        ]
          .filter(Boolean)
          .join("\n");
        return { content: [{ type: "text" as const, text: infoText }] };
      }

      const readiness = await getListExportReadiness(list_id);
      const {
        totalCount,
        readyCount,
        needsVerificationCount,
        blockedCount,
        verifiedEmailPct,
        verticalBreakdown,
        enrichmentCoverage,
      } = readiness;

      // Generate campaign name for the summary
      const dateStr = new Date().toISOString().slice(0, 10);
      const safeName = (s: string) => s.replace(/\s+/g, "_");
      const campaignName = `${safeName(ws.name)}_${safeName(list.name)}_${dateStr}`;
      const campaignDesc = template_campaign_id
        ? `${campaignName} (duplicated from #${template_campaign_id} — inherits email sequence)`
        : `${campaignName} (new — no email sequence)`;

      // Build vertical breakdown lines
      const verticalLines = Object.entries(verticalBreakdown)
        .map(([v, c]) => `- ${v}: ${c}`)
        .join("\n");

      // Build footer guidance
      let footer = "";
      if (needsVerificationCount > 0) {
        footer = `\u26A0 Some emails are unverified. Set verify_unverified=true to verify them first, or set confirm=true to export only the ${readyCount} verified leads (excluding ${blockedCount + needsVerificationCount} unready).`;
      } else if (blockedCount > 0) {
        footer = `\u2139 ${blockedCount} leads will be auto-excluded (invalid/catch-all emails). ${readyCount} leads will be pushed.`;
      } else {
        footer = `\u2713 All emails verified. Set confirm=true to push.`;
      }

      const estimatedCost = (needsVerificationCount * 0.05).toFixed(2);

      const lines = [
        workspaceCreatedMessage,
        "## Pre-Export Summary",
        "",
        `**List:** ${list.name} (${totalCount} people)`,
        `**Workspace:** ${ws.name} (${ws.slug})`,
        `**Campaign:** ${campaignDesc}`,
        "",
        "### Email Verification",
        `- Ready (verified valid): ${readyCount} (${verifiedEmailPct}%)`,
        `- Needs verification: ${needsVerificationCount}`,
        `- Blocked (invalid/catch-all): ${blockedCount}`,
        "",
        "### Enrichment Coverage",
        `- Company data: ${enrichmentCoverage.companyDataPct}%`,
        `- LinkedIn profiles: ${enrichmentCoverage.linkedinPct}%`,
        `- Job titles: ${enrichmentCoverage.jobTitlePct}%`,
        "",
        "### Vertical Breakdown",
        verticalLines,
        "",
        "### Estimated Verification Cost",
        `~$${estimatedCost} (${needsVerificationCount} emails x $0.05/each)`,
        "",
        "---",
        footer,
      ]
        .filter((l) => l !== undefined)
        .join("\n");

      return { content: [{ type: "text" as const, text: lines }] };
    },
  );

  // ─── Tool 2: export_csv ─────────────────────────────────────────────────────
  server.tool(
    "export_csv",
    "Generate a CSV file for all exportable members of a TargetList. Enforces the verification gate (all emails must be verified). Optionally writes the CSV to disk at ./exports/{filename}.",
    {
      list_id: z.string().describe("TargetList ID to export"),
      save_to_disk: z
        .boolean()
        .default(false)
        .describe(
          "If true, write the CSV to ./exports/{filename} on the server filesystem.",
        ),
    },
    async (params) => {
      const { list_id, save_to_disk } = params;

      let result: { csv: string; filename: string; count: number };
      try {
        result = await generateListCsv(list_id);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error during CSV generation.";
        return {
          content: [{ type: "text" as const, text: message }],
        };
      }

      const { csv, filename, count } = result;

      if (save_to_disk) {
        const exportsDir = join(process.cwd(), "exports");
        mkdirSync(exportsDir, { recursive: true });
        writeFileSync(join(exportsDir, filename), csv, "utf-8");
        return {
          content: [
            {
              type: "text" as const,
              text: `CSV exported: ./exports/${filename} (${count} people, ${csv.length} bytes)\n\nAlso available via API: GET /api/lists/${list_id}/export`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `CSV generated: ${filename} (${count} people)\n\nDownload via API: GET /api/lists/${list_id}/export\n\nOr set save_to_disk=true to write to ./exports/${filename}`,
          },
        ],
      };
    },
  );
}
