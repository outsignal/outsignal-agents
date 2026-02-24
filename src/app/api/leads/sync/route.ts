import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";

export async function POST() {
  const allWorkspaces = await getAllWorkspaces();
  const workspaces = allWorkspaces.filter((w) => w.hasApiToken);
  const results: Record<string, { synced: number; errors: number }> = {};

  for (const ws of workspaces) {
    const wsConfig = await getWorkspaceBySlug(ws.slug);
    if (!wsConfig) continue;
    const client = new EmailBisonClient(wsConfig.apiToken);
    let synced = 0;
    let errors = 0;

    try {
      const leads = await client.getLeads();
      for (const lead of leads) {
        try {
          await prisma.lead.upsert({
            where: {
              email_workspace: {
                email: lead.email,
                workspace: ws.slug,
              },
            },
            create: {
              email: lead.email,
              firstName: lead.first_name ?? null,
              lastName: lead.last_name ?? null,
              company: lead.company ?? null,
              phone: lead.phone ?? null,
              source: "emailbison",
              sourceId: lead.id.toString(),
              workspace: ws.slug,
              vertical: ws.vertical ?? null,
              tags: lead.tags?.map((t) => t.name).join(",") ?? null,
            },
            update: {
              firstName: lead.first_name ?? undefined,
              lastName: lead.last_name ?? undefined,
              company: lead.company ?? undefined,
              phone: lead.phone ?? undefined,
              tags: lead.tags?.map((t) => t.name).join(",") ?? undefined,
            },
          });
          synced++;
        } catch {
          errors++;
        }
      }
    } catch (err) {
      console.error(`Failed to sync workspace ${ws.slug}:`, err);
      errors++;
    }

    results[ws.slug] = { synced, errors };
  }

  return NextResponse.json({ results });
}
