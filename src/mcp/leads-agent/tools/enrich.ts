/**
 * Enrichment tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - enrich_person: Trigger the enrichment waterfall for a person.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  enrichEmail,
  enrichCompany,
  createCircuitBreaker,
} from "@/lib/enrichment/waterfall";
import type { EmailAdapterInput } from "@/lib/enrichment/types";

export function registerEnrichTools(server: McpServer): void {
  server.tool(
    "enrich_person",
    "Trigger the enrichment waterfall for a person (AI Ark → Prospeo → LeadMagic → FindyMail for email; AI Ark → Firecrawl for company). Call first without confirm=true to see what will happen.",
    {
      person_id: z.string().describe("Person ID to enrich"),
      workspace: z
        .string()
        .optional()
        .describe("Workspace slug for cost tracking"),
      confirm: z
        .boolean()
        .default(false)
        .describe(
          "Set to true to proceed with enrichment. First call without confirm to see cost estimate.",
        ),
    },
    async (params) => {
      const { person_id, workspace, confirm } = params;

      // Fetch the person
      const person = await prisma.person.findUniqueOrThrow({
        where: { id: person_id },
      });

      const name =
        [person.firstName, person.lastName].filter(Boolean).join(" ") ||
        person.email;

      if (!confirm) {
        // Show a pre-flight summary before executing
        const existingLogs = await prisma.enrichmentLog.findMany({
          where: { entityId: person_id, entityType: "person", status: "success" },
          select: { provider: true, fieldsWritten: true, runAt: true },
          orderBy: { runAt: "desc" },
        });

        const enrichedProviders = [
          ...new Set(existingLogs.map((l) => l.provider)),
        ];
        const existingStr =
          enrichedProviders.length > 0
            ? enrichedProviders.join(", ")
            : "None yet";

        const willRun: string[] = [];
        if (!enrichedProviders.includes("aiark")) willRun.push("AI Ark (person data)");
        if (!enrichedProviders.includes("prospeo")) willRun.push("Prospeo (email finding)");
        if (!enrichedProviders.includes("leadmagic")) willRun.push("LeadMagic (email finding)");
        if (!enrichedProviders.includes("findymail")) willRun.push("FindyMail (email finding)");
        if (person.companyDomain && !enrichedProviders.includes("firecrawl")) {
          willRun.push("Firecrawl (company data)");
        }

        const willRunStr =
          willRun.length > 0 ? willRun.join(", ") : "Nothing new (all providers already run)";

        const text = [
          `Person: ${name} (${person.email})`,
          `Existing enrichments: ${existingStr}`,
          `Waterfall will run: ${willRunStr}`,
          "",
          "Estimated cost: ~$0.01-0.05",
          "Set confirm=true to proceed.",
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      }

      // Execute enrichment waterfall
      const breaker = createCircuitBreaker();
      const input: EmailAdapterInput = {
        linkedinUrl: person.linkedinUrl ?? undefined,
        firstName: person.firstName ?? undefined,
        lastName: person.lastName ?? undefined,
        companyName: person.company ?? undefined,
        companyDomain: person.companyDomain ?? undefined,
      };

      try {
        await enrichEmail(person_id, input, breaker, workspace);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "DAILY_CAP_HIT") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Enrichment paused: daily cost cap reached. Will resume automatically at midnight UTC.",
              },
            ],
          };
        }
        console.error("[enrich_person] enrichEmail error:", err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Enrichment failed (email step): ${msg}`,
            },
          ],
        };
      }

      if (person.companyDomain) {
        try {
          await enrichCompany(person.companyDomain, breaker, workspace);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg !== "DAILY_CAP_HIT") {
            console.error("[enrich_person] enrichCompany error:", err);
          }
          // Don't block on company enrichment failure — email enrichment may have succeeded
        }
      }

      // Re-fetch updated person
      const updated = await prisma.person.findUnique({ where: { id: person_id } });
      if (!updated) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Enrichment completed but could not re-fetch person record.",
            },
          ],
        };
      }

      const updatedName =
        [updated.firstName, updated.lastName].filter(Boolean).join(" ") ||
        updated.email;

      const text = [
        "Enrichment complete.",
        "",
        `Name: ${updatedName}`,
        `Email: ${updated.email}`,
        `Company: ${updated.company ?? "_—_"}`,
        `Job Title: ${updated.jobTitle ?? "_—_"}`,
        `LinkedIn: ${updated.linkedinUrl ?? "_—_"}`,
        `Location: ${updated.location ?? "_—_"}`,
        `Company Domain: ${updated.companyDomain ?? "_—_"}`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
