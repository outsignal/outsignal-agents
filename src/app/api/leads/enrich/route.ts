import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/normalize";

interface EnrichmentPayload {
  email: string;
  linkedinUrl?: string;
  companyDomain?: string;
  location?: string;
  phone?: string;
  jobTitle?: string;
  company?: string;
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  "email",
  "linkedinUrl",
  "companyDomain",
  "location",
  "phone",
  "jobTitle",
  "company",
];

async function enrichLead(
  payload: EnrichmentPayload,
  workspace?: string,
): Promise<{ updated: boolean; count: number; error?: string }> {
  const { email } = payload;

  if (!email || typeof email !== "string") {
    return { updated: false, count: 0, error: "email is required" };
  }

  const normalizedEmail = email.toLowerCase().trim();

  // Build the where clause
  const whereClause: Record<string, unknown> = { email: normalizedEmail };
  if (workspace) {
    whereClause.workspace = workspace;
  }

  // Find matching leads
  const leads = await prisma.lead.findMany({ where: whereClause });

  if (leads.length === 0) {
    return {
      updated: false,
      count: 0,
      error: `No lead found with email ${normalizedEmail}${workspace ? ` in workspace ${workspace}` : ""}`,
    };
  }

  // Collect extra fields into enrichmentData
  const extraFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!KNOWN_FIELDS.includes(key) && value !== undefined && value !== null) {
      extraFields[key] = value;
    }
  }

  let totalUpdated = 0;

  for (const lead of leads) {
    // Build update data — only set fields that Clay provided
    const updateData: Record<string, unknown> = {};

    if (payload.linkedinUrl) {
      updateData.linkedinUrl = payload.linkedinUrl;
    }

    if (payload.companyDomain) {
      updateData.companyDomain = payload.companyDomain;
    }

    if (payload.location) {
      updateData.location = payload.location;
    }

    // Only set phone/jobTitle/company if the lead doesn't already have them
    if (payload.phone && !lead.phone) {
      updateData.phone = payload.phone;
    }

    if (payload.jobTitle && !lead.jobTitle) {
      updateData.jobTitle = payload.jobTitle;
    }

    if (payload.company && !lead.company) {
      updateData.company = normalizeCompanyName(payload.company);
    }

    // Merge extra fields into enrichmentData
    if (Object.keys(extraFields).length > 0) {
      let existing: Record<string, unknown> = {};
      if (lead.enrichmentData) {
        try {
          existing = JSON.parse(lead.enrichmentData);
        } catch {
          existing = {};
        }
      }
      const merged = { ...existing, ...extraFields };
      updateData.enrichmentData = JSON.stringify(merged);
    }

    if (Object.keys(updateData).length === 0) {
      continue;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: updateData,
    });

    totalUpdated++;
  }

  return { updated: totalUpdated > 0, count: totalUpdated };
}

export async function POST(request: NextRequest) {
  try {
    // API key check (optional — skipped if env var not set)
    const secret = process.env.CLAY_WEBHOOK_SECRET;
    if (secret) {
      const apiKey = request.headers.get("x-api-key");
      if (apiKey !== secret) {
        return NextResponse.json(
          { error: "Invalid or missing API key" },
          { status: 401 },
        );
      }
    }

    const workspace =
      request.nextUrl.searchParams.get("workspace") || undefined;

    const body = await request.json();

    // Batch mode: body is an array
    if (Array.isArray(body)) {
      const results: {
        email: string;
        updated: boolean;
        count: number;
        error?: string;
      }[] = [];
      let totalCount = 0;

      for (const item of body) {
        const result = await enrichLead(item, workspace);
        results.push({ email: item.email ?? "(missing)", ...result });
        totalCount += result.count;
      }

      return NextResponse.json({
        updated: totalCount > 0,
        count: totalCount,
        results,
      });
    }

    // Single mode
    const result = await enrichLead(body, workspace);

    if (result.error && result.count === 0) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 },
      );
    }

    return NextResponse.json({
      updated: result.updated,
      count: result.count,
    });
  } catch (error) {
    console.error("Enrichment error:", error);
    return NextResponse.json(
      { error: "Failed to enrich lead" },
      { status: 500 },
    );
  }
}
