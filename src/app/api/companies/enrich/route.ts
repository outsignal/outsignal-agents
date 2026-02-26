import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/normalize";

interface CompanyPayload {
  domain: string;
  name?: string;
  industry?: string;
  headcount?: number;
  location?: string;
  website?: string;
  linkedinUrl?: string;
  description?: string;
  revenue?: string;
  yearFounded?: number;
  companyType?: string;
  techStack?: string | string[];
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  "domain",
  "name",
  "industry",
  "headcount",
  "location",
  "website",
  "linkedinUrl",
  "description",
  "revenue",
  "yearFounded",
  "companyType",
  "techStack",
];

// Map snake_case / alternate field names from Clay to our camelCase fields
const FIELD_ALIASES: Record<string, string> = {
  linkedin_url: "linkedinUrl",
  linkedin_profile: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  year_founded: "yearFounded",
  yearfounded: "yearFounded",
  company_type: "companyType",
  companytype: "companyType",
  tech_stack: "techStack",
  techstack: "techStack",
};

function normalizePayload(raw: Record<string, unknown>): CompanyPayload {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mapped = FIELD_ALIASES[key] ?? FIELD_ALIASES[key.toLowerCase()] ?? key;
    if (normalized[mapped] === undefined || normalized[mapped] === null) {
      normalized[mapped] = value;
    }
  }
  return normalized as CompanyPayload;
}

async function enrichCompany(
  payload: CompanyPayload,
): Promise<{ updated: boolean; created: boolean; error?: string }> {
  const { domain } = payload;

  if (!domain || typeof domain !== "string") {
    return { updated: false, created: false, error: "domain is required" };
  }

  const normalizedDomain = domain.toLowerCase().trim().replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/.*$/, "");

  if (!normalizedDomain) {
    return { updated: false, created: false, error: "invalid domain" };
  }

  // Coerce string numbers from Clay into actual numbers
  const headcount = payload.headcount != null ? Number(payload.headcount) || null : null;
  const yearFounded = payload.yearFounded != null ? Number(payload.yearFounded) || null : null;

  // Collect extra fields into enrichmentData
  const extraFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!KNOWN_FIELDS.includes(key) && value !== undefined && value !== null) {
      extraFields[key] = value;
    }
  }

  const enrichmentJson = Object.keys(extraFields).length > 0
    ? JSON.stringify(extraFields)
    : undefined;

  const techStackJson = payload.techStack
    ? JSON.stringify(
        Array.isArray(payload.techStack)
          ? payload.techStack
          : [payload.techStack],
      )
    : undefined;

  const name = payload.name
    ? normalizeCompanyName(payload.name)
    : normalizedDomain;

  const existing = await prisma.company.findUnique({
    where: { domain: normalizedDomain },
  });

  if (existing) {
    // Merge enrichmentData
    let mergedEnrichment = enrichmentJson;
    if (enrichmentJson && existing.enrichmentData) {
      try {
        const prev = JSON.parse(existing.enrichmentData);
        const next = JSON.parse(enrichmentJson);
        mergedEnrichment = JSON.stringify({ ...prev, ...next });
      } catch {
        // keep new
      }
    }

    await prisma.company.update({
      where: { domain: normalizedDomain },
      data: {
        name: payload.name ? normalizeCompanyName(payload.name) : undefined,
        industry: payload.industry ?? undefined,
        headcount: headcount ?? undefined,
        location: payload.location ?? undefined,
        website: payload.website ?? undefined,
        linkedinUrl: payload.linkedinUrl ?? undefined,
        description: payload.description ?? undefined,
        revenue: payload.revenue ?? undefined,
        yearFounded: yearFounded ?? undefined,
        companyType: payload.companyType ?? undefined,
        techStack: techStackJson,
        enrichmentData: mergedEnrichment,
      },
    });

    // Also update any people with this companyDomain that are missing industry
    if (payload.industry) {
      await prisma.person.updateMany({
        where: {
          companyDomain: normalizedDomain,
          vertical: null,
        },
        data: { vertical: payload.industry },
      });
    }

    return { updated: true, created: false };
  }

  // Create new company
  await prisma.company.create({
    data: {
      name,
      domain: normalizedDomain,
      industry: payload.industry ?? null,
      headcount: headcount ?? null,
      location: payload.location ?? null,
      website: payload.website ?? null,
      linkedinUrl: payload.linkedinUrl ?? null,
      description: payload.description ?? null,
      revenue: payload.revenue ?? null,
      yearFounded: yearFounded ?? null,
      companyType: payload.companyType ?? null,
      techStack: techStackJson ?? null,
      enrichmentData: enrichmentJson ?? null,
    },
  });

  // Backfill vertical on people with this domain
  if (payload.industry) {
    await prisma.person.updateMany({
      where: {
        companyDomain: normalizedDomain,
        vertical: null,
      },
      data: { vertical: payload.industry },
    });
  }

  return { updated: false, created: true };
}

export async function POST(request: NextRequest) {
  try {
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

    const body = await request.json();

    // Batch mode
    if (Array.isArray(body)) {
      const results: {
        domain: string;
        updated: boolean;
        created: boolean;
        error?: string;
      }[] = [];
      let totalCreated = 0;
      let totalUpdated = 0;

      for (const item of body) {
        const result = await enrichCompany(normalizePayload(item));
        results.push({ domain: item.domain ?? "(missing)", ...result });
        if (result.created) totalCreated++;
        if (result.updated) totalUpdated++;
      }

      return NextResponse.json({
        created: totalCreated,
        updated: totalUpdated,
        results,
      });
    }

    // Single mode
    const result = await enrichCompany(normalizePayload(body));

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Company enrichment error:", error);
    return NextResponse.json(
      { error: "Failed to enrich company" },
      { status: 500 },
    );
  }
}
