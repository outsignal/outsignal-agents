import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { normalizeCompanyName } from "@/lib/normalize";
import { validateApiSecret } from "@/lib/api-auth";

export async function POST(request: Request) {
  if (!validateApiSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

      // Process in batches of 50 inside a single transaction to eliminate N+1 queries
      const BATCH_SIZE = 50;
      for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        const batch = leads.slice(i, i + BATCH_SIZE);

        // Build all upsert operations for this batch
        const operations = batch.map((lead) => ({
          personUpsert: prisma.person.upsert({
            where: {
              email: lead.email,
            },
            create: {
              email: lead.email,
              firstName: lead.first_name ?? null,
              lastName: lead.last_name ?? null,
              jobTitle: lead.title ?? null,
              company: lead.company ? normalizeCompanyName(lead.company) : null,
              phone: lead.phone ?? null,
              enrichmentData: lead.custom_variables
                ? JSON.stringify(lead.custom_variables)
                : null,
              source: "emailbison",
            },
            update: {
              firstName: lead.first_name ?? undefined,
              lastName: lead.last_name ?? undefined,
              jobTitle: lead.title ?? undefined,
              company: lead.company ? normalizeCompanyName(lead.company) : undefined,
              phone: lead.phone ?? undefined,
              enrichmentData: lead.custom_variables
                ? JSON.stringify(lead.custom_variables)
                : undefined,
            },
          }),
          lead,
        }));

        // Step 1: Batch all person upserts in a single transaction
        let upsertedPeople: Awaited<ReturnType<typeof prisma.person.upsert>>[];
        try {
          upsertedPeople = await prisma.$transaction(
            operations.map((op) => op.personUpsert)
          );
        } catch {
          // If the whole batch transaction fails, fall back to individual upserts
          // to match original per-record error handling
          for (const op of operations) {
            try {
              const upsertedLead = await prisma.person.upsert(
                // Re-create the upsert since the previous promise is consumed
                {
                  where: { email: op.lead.email },
                  create: {
                    email: op.lead.email,
                    firstName: op.lead.first_name ?? null,
                    lastName: op.lead.last_name ?? null,
                    jobTitle: op.lead.title ?? null,
                    company: op.lead.company ? normalizeCompanyName(op.lead.company) : null,
                    phone: op.lead.phone ?? null,
                    enrichmentData: op.lead.custom_variables
                      ? JSON.stringify(op.lead.custom_variables)
                      : null,
                    source: "emailbison",
                  },
                  update: {
                    firstName: op.lead.first_name ?? undefined,
                    lastName: op.lead.last_name ?? undefined,
                    jobTitle: op.lead.title ?? undefined,
                    company: op.lead.company ? normalizeCompanyName(op.lead.company) : undefined,
                    phone: op.lead.phone ?? undefined,
                    enrichmentData: op.lead.custom_variables
                      ? JSON.stringify(op.lead.custom_variables)
                      : undefined,
                  },
                }
              );

              await prisma.personWorkspace.upsert({
                where: {
                  personId_workspace: {
                    personId: upsertedLead.id,
                    workspace: ws.slug,
                  },
                },
                create: {
                  personId: upsertedLead.id,
                  workspace: ws.slug,
                  sourceId: op.lead.id.toString(),
                  status: op.lead.status ?? "new",
                  vertical: ws.vertical ?? null,
                  tags: op.lead.tags?.map((t: { name: string }) => t.name).join(",") ?? null,
                },
                update: {
                  sourceId: op.lead.id.toString(),
                  status: op.lead.status ?? undefined,
                  vertical: ws.vertical ?? undefined,
                  tags: op.lead.tags?.map((t: { name: string }) => t.name).join(",") ?? undefined,
                },
              });

              synced++;
            } catch {
              errors++;
            }
          }
          continue;
        }

        // Step 2: Batch all personWorkspace upserts in a single transaction
        const workspaceUpserts = upsertedPeople.map((upsertedLead, idx) => {
          const lead = batch[idx];
          return prisma.personWorkspace.upsert({
            where: {
              personId_workspace: {
                personId: upsertedLead.id,
                workspace: ws.slug,
              },
            },
            create: {
              personId: upsertedLead.id,
              workspace: ws.slug,
              sourceId: lead.id.toString(),
              status: lead.status ?? "new",
              vertical: ws.vertical ?? null,
              tags: lead.tags?.map((t: { name: string }) => t.name).join(",") ?? null,
            },
            update: {
              sourceId: lead.id.toString(),
              status: lead.status ?? undefined,
              vertical: ws.vertical ?? undefined,
              tags: lead.tags?.map((t: { name: string }) => t.name).join(",") ?? undefined,
            },
          });
        });

        try {
          await prisma.$transaction(workspaceUpserts);
          synced += batch.length;
        } catch {
          // If batch workspace upsert fails, fall back to individual for error isolation
          for (let idx = 0; idx < batch.length; idx++) {
            try {
              const upsertedLead = upsertedPeople[idx];
              const lead = batch[idx];
              await prisma.personWorkspace.upsert({
                where: {
                  personId_workspace: {
                    personId: upsertedLead.id,
                    workspace: ws.slug,
                  },
                },
                create: {
                  personId: upsertedLead.id,
                  workspace: ws.slug,
                  sourceId: lead.id.toString(),
                  status: lead.status ?? "new",
                  vertical: ws.vertical ?? null,
                  tags: lead.tags?.map((t: { name: string }) => t.name).join(",") ?? null,
                },
                update: {
                  sourceId: lead.id.toString(),
                  status: lead.status ?? undefined,
                  vertical: ws.vertical ?? undefined,
                  tags: lead.tags?.map((t: { name: string }) => t.name).join(",") ?? undefined,
                },
              });
              synced++;
            } catch {
              errors++;
            }
          }
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
