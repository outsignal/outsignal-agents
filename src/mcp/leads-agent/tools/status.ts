/**
 * Status management tools for the Outsignal Leads Agent MCP server.
 *
 * Tools registered:
 *   - update_lead_status: Change a person's status.
 *
 * CRITICAL: No console.log — stdout is reserved for JSON-RPC protocol messages.
 * Use console.error for logging.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";

export function registerStatusTools(server: McpServer): void {
  server.tool(
    "update_lead_status",
    "Update a person's status (new, contacted, replied, interested, bounced, unsubscribed).",
    {
      person_id: z.string().describe("Person ID to update"),
      status: z
        .enum([
          "new",
          "contacted",
          "replied",
          "interested",
          "bounced",
          "unsubscribed",
        ])
        .describe("New status to set"),
      workspace: z
        .string()
        .optional()
        .describe(
          "Also update status on PersonWorkspace record if provided",
        ),
    },
    async (params) => {
      const { person_id, status, workspace } = params;

      // Update the Person record
      const person = await prisma.person.update({
        where: { id: person_id },
        data: { status },
        select: { firstName: true, lastName: true, email: true },
      });

      const name =
        [person.firstName, person.lastName].filter(Boolean).join(" ") ||
        person.email;

      // Optionally update the PersonWorkspace record
      if (workspace) {
        await prisma.personWorkspace.updateMany({
          where: { personId: person_id, workspace },
          data: { status },
        });
      }

      const text = `Updated ${name} status to '${status}'.`;
      return { content: [{ type: "text" as const, text }] };
    },
  );
}
