/**
 * POST /api/enrichment/run
 *
 * Enqueue a batch enrichment job.
 *
 * Body: { entityType: "person" | "company", workspaceSlug?: string, limit?: number }
 *
 * For "person": finds people without email who have a LinkedIn URL or name+company,
 *   then queues them for the email waterfall (Prospeo → LeadMagic → FindyMail).
 *
 * For "company": finds companies missing key data (industry, headcount, or description),
 *   then queues them for the company waterfall (AI Ark → Firecrawl).
 *
 * Defaults: limit = 100.
 *
 * Response:
 *   - 200 { jobId, count } — job enqueued
 *   - 200 { message: "No eligible records found", count: 0 } — nothing to enrich
 *   - 400 { error: string } — invalid request body
 *   - 500 { error: string } — enqueue failed
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/enrichment/queue";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityType, workspaceSlug, limit = 100 } = body as {
      entityType: string;
      workspaceSlug?: string;
      limit?: number;
    };

    if (!entityType || !["person", "company"].includes(entityType)) {
      return NextResponse.json(
        { error: "entityType must be 'person' or 'company'" },
        { status: 400 },
      );
    }

    let entityIds: string[];

    if (entityType === "person") {
      // Find people without email who have sufficient data for at least one provider
      // Find people with enrichable data (LinkedIn URL or name+company).
      // Dedup is enforced per-provider inside the waterfall — this just builds
      // the candidate list. If a person was already enriched by all providers,
      // their waterfall calls will be no-ops.
      const people = await prisma.person.findMany({
        where: {
          OR: [
            { linkedinUrl: { not: null } },
            {
              AND: [
                { firstName: { not: null } },
                { company: { not: null } },
              ],
            },
          ],
          ...(workspaceSlug
            ? { workspaces: { some: { workspace: workspaceSlug } } }
            : {}),
        },
        select: { id: true },
        take: limit,
      });
      entityIds = people.map((p) => p.id);
    } else {
      // Find companies missing key enrichment data
      const companies = await prisma.company.findMany({
        where: {
          OR: [
            { industry: null },
            { headcount: null },
            { description: null },
          ],
        },
        select: { id: true },
        take: limit,
      });
      entityIds = companies.map((c) => c.id);
    }

    if (entityIds.length === 0) {
      return NextResponse.json({ message: "No eligible records found", count: 0 });
    }

    const jobId = await enqueueJob({
      entityType: entityType as "person" | "company",
      // Convention: use the first provider in the waterfall as the job's provider label
      provider: entityType === "person" ? "prospeo" : "aiark",
      entityIds,
      workspaceSlug,
    });

    return NextResponse.json({ jobId, count: entityIds.length });
  } catch (error) {
    console.error("Enrichment run error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to enqueue enrichment job" },
      { status: 500 },
    );
  }
}
