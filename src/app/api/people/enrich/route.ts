import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/normalize";

interface EnrichmentPayload {
  email: string;
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string;
  companyDomain?: string;
  location?: string;
  phone?: string;
  jobTitle?: string;
  company?: string;
  vertical?: string;
  industry?: string; // alias for vertical
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  "email",
  "firstName",
  "lastName",
  "linkedinUrl",
  "companyDomain",
  "location",
  "phone",
  "jobTitle",
  "company",
  "vertical",
  "industry",
];

// Map snake_case / alternate field names from Clay to our camelCase fields
const FIELD_ALIASES: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  linkedin_url: "linkedinUrl",
  linkedin_profile: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  company_domain: "companyDomain",
  companydomain: "companyDomain",
  job_title: "jobTitle",
  jobtitle: "jobTitle",
};

function normalizePayload(raw: Record<string, unknown>): EnrichmentPayload {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const mapped = FIELD_ALIASES[key] ?? FIELD_ALIASES[key.toLowerCase()] ?? key;
    // Don't overwrite if we already have a value for this field
    if (normalized[mapped] === undefined || normalized[mapped] === null) {
      normalized[mapped] = value;
    }
  }
  return normalized as EnrichmentPayload;
}

async function enrichPerson(
  payload: EnrichmentPayload,
): Promise<{ created: boolean; updated: boolean; error?: string }> {
  const { email } = payload;

  if (!email || typeof email !== "string") {
    return { created: false, updated: false, error: "email is required" };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const vertical = payload.vertical ?? payload.industry;
  const companyName = payload.company
    ? normalizeCompanyName(payload.company)
    : undefined;

  // Collect extra fields into enrichmentData
  const extraFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!KNOWN_FIELDS.includes(key) && value !== undefined && value !== null) {
      extraFields[key] = value;
    }
  }
  const extraJson = Object.keys(extraFields).length > 0
    ? JSON.stringify(extraFields)
    : null;

  // Check if person exists
  const existing = await prisma.person.findUnique({
    where: { email: normalizedEmail },
  });

  if (!existing) {
    // Create new person
    await prisma.person.create({
      data: {
        email: normalizedEmail,
        firstName: payload.firstName ?? null,
        lastName: payload.lastName ?? null,
        company: companyName ?? null,
        companyDomain: payload.companyDomain ?? null,
        jobTitle: payload.jobTitle ?? null,
        phone: payload.phone ?? null,
        linkedinUrl: payload.linkedinUrl ?? null,
        location: payload.location ?? null,
        vertical: vertical ?? null,
        source: "clay",
        enrichmentData: extraJson,
      },
    });

    // Auto-create Company record
    const domain = payload.companyDomain;
    if (domain) {
      const normalizedDomain = domain.toLowerCase().trim();
      try {
        await prisma.company.upsert({
          where: { domain: normalizedDomain },
          create: {
            domain: normalizedDomain,
            name: companyName ?? normalizedDomain,
            industry: vertical ?? null,
            location: payload.location ?? null,
          },
          update: {
            ...(companyName ? { name: companyName } : {}),
            ...(vertical ? { industry: vertical } : {}),
          },
        });
      } catch {
        // Non-critical
      }
    }

    return { created: true, updated: false };
  }

  // Update existing person
  const updateData: Record<string, unknown> = {};

  if (payload.linkedinUrl) updateData.linkedinUrl = payload.linkedinUrl;
  if (payload.companyDomain) updateData.companyDomain = payload.companyDomain;
  if (payload.location) updateData.location = payload.location;
  if (payload.firstName && !existing.firstName) updateData.firstName = payload.firstName;
  if (payload.lastName && !existing.lastName) updateData.lastName = payload.lastName;
  if (payload.phone && !existing.phone) updateData.phone = payload.phone;
  if (payload.jobTitle && !existing.jobTitle) updateData.jobTitle = payload.jobTitle;
  if (companyName && !existing.company) updateData.company = companyName;
  if (vertical) updateData.vertical = vertical;

  // Merge extra fields into enrichmentData
  if (extraJson) {
    let prev: Record<string, unknown> = {};
    if (existing.enrichmentData) {
      try { prev = JSON.parse(existing.enrichmentData); } catch { /* ignore */ }
    }
    updateData.enrichmentData = JSON.stringify({ ...prev, ...extraFields });
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.person.update({
      where: { id: existing.id },
      data: updateData,
    });
  }

  // Auto-create/update Company record
  const domain = (updateData.companyDomain as string) ?? existing.companyDomain;
  if (domain) {
    const normalizedDomain = domain.toLowerCase().trim();
    const name = (updateData.company as string) ?? existing.company;
    try {
      await prisma.company.upsert({
        where: { domain: normalizedDomain },
        create: {
          domain: normalizedDomain,
          name: name ?? normalizedDomain,
          industry: vertical ?? null,
          location: (payload.location as string) ?? null,
        },
        update: {
          ...(name ? { name } : {}),
          ...(vertical ? { industry: vertical } : {}),
        },
      });
    } catch {
      // Non-critical
    }
  }

  return { created: false, updated: Object.keys(updateData).length > 0 };
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

    const body = await request.json();

    // Batch mode: body is an array
    if (Array.isArray(body)) {
      const results: {
        email: string;
        created: boolean;
        updated: boolean;
        error?: string;
      }[] = [];
      let totalCreated = 0;
      let totalUpdated = 0;

      for (const item of body) {
        const result = await enrichPerson(normalizePayload(item));
        results.push({ email: item.email ?? "(missing)", ...result });
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
    const result = await enrichPerson(normalizePayload(body));

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Enrichment error:", error);
    return NextResponse.json(
      { error: "Failed to enrich person" },
      { status: 500 },
    );
  }
}
