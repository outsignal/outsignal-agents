import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/normalize";
import { parseJsonBody } from "@/lib/parse-json";
import { rateLimit } from "@/lib/rate-limit";

const enrichLimiter = rateLimit({ windowMs: 60_000, max: 30 });

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
  workspace?: string; // workspace slug — links person to workspace
  targetListId?: string; // target list ID — adds person to list
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
  "workspace",
  "targetListId",
];

// Map snake_case / alternate field names from ingest payload to our camelCase fields
const FIELD_ALIASES: Record<string, string> = {
  first_name: "firstName",
  last_name: "lastName",
  linkedin_url: "linkedinUrl",
  linkedin_profile: "linkedinUrl",
  personal_linkedin: "linkedinUrl",
  linkedinurl: "linkedinUrl",
  company_domain: "companyDomain",
  companydomain: "companyDomain",
  job_title: "jobTitle",
  jobtitle: "jobTitle",
  target_list_id: "targetListId",
  targetlistid: "targetListId",
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

async function linkPersonToWorkspaceAndList(
  personId: string,
  payload: EnrichmentPayload,
  vertical?: string | null,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] = prisma,
): Promise<{ workspaceLinked?: boolean; listAdded?: boolean }> {
  const result: { workspaceLinked?: boolean; listAdded?: boolean } = {};

  if (payload.workspace) {
    // Validate workspace exists
    const ws = await tx.workspace.findUnique({
      where: { slug: payload.workspace },
    });
    if (!ws) {
      return result; // silently skip — workspace doesn't exist
    }

    await tx.personWorkspace.upsert({
      where: {
        personId_workspace: {
          personId,
          workspace: payload.workspace,
        },
      },
      create: {
        personId,
        workspace: payload.workspace,
        vertical: vertical ?? undefined,
      },
      update: {},
    });
    result.workspaceLinked = true;
  }

  if (payload.targetListId) {
    // Validate target list exists
    const list = await tx.targetList.findUnique({
      where: { id: payload.targetListId },
    });
    if (!list) {
      return result; // silently skip — list doesn't exist
    }

    // Check if already in list to avoid duplicate error
    const existing = await tx.targetListPerson.findUnique({
      where: {
        listId_personId: {
          listId: payload.targetListId,
          personId,
        },
      },
    });
    if (!existing) {
      await tx.targetListPerson.create({
        data: {
          listId: payload.targetListId,
          personId,
        },
      });
    }
    result.listAdded = true;
  }

  return result;
}

async function enrichPerson(
  payload: EnrichmentPayload,
): Promise<{
  created: boolean;
  updated: boolean;
  workspaceLinked?: boolean;
  listAdded?: boolean;
  error?: string;
}> {
  const { email } = payload;

  if (!email || typeof email !== "string") {
    return { created: false, updated: false, error: "email is required" };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const vertical = payload.vertical ?? payload.industry;
  const companyName = payload.company
    ? normalizeCompanyName(payload.company)
    : undefined;

  // Auto-derive companyDomain from email if not provided
  const FREE_EMAIL_DOMAINS = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
    "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "aol.com",
    "icloud.com", "me.com", "mac.com", "mail.com", "mail.ru", "msn.com",
    "protonmail.com", "proton.me", "ymail.com", "zoho.com", "gmx.com",
    "fastmail.com", "hey.com", "tutanota.com", "pm.me",
  ]);
  if (!payload.companyDomain) {
    const emailDomain = normalizedEmail.split("@")[1];
    if (emailDomain && !FREE_EMAIL_DOMAINS.has(emailDomain)) {
      payload.companyDomain = emailDomain;
    }
  }

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
    // Create new person, company, and workspace link in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const person = await tx.person.create({
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
          source: "webhook",
          enrichmentData: extraJson,
        },
      });

      // Auto-create Company record
      const domain = payload.companyDomain;
      if (domain) {
        const normalizedDomain = domain.toLowerCase().trim();
        try {
          await tx.company.upsert({
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

      // Link to workspace and target list
      const linkResult = await linkPersonToWorkspaceAndList(person.id, payload, vertical, tx);

      return { created: true, updated: false, ...linkResult };
    });

    return result;
  }

  // Update existing person, company, and workspace link in a transaction
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

  const result = await prisma.$transaction(async (tx) => {
    if (Object.keys(updateData).length > 0) {
      await tx.person.update({
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
        await tx.company.upsert({
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

    // Link to workspace and target list
    const linkResult = await linkPersonToWorkspaceAndList(existing.id, payload, vertical, tx);

    return { created: false, updated: Object.keys(updateData).length > 0, ...linkResult };
  });

  return result;
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting — 30 requests per minute per IP
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const { success: rateLimitOk } = enrichLimiter(ip);
    if (!rateLimitOk) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    // API key check — reject all requests when INGEST_WEBHOOK_SECRET is not configured
    const secret = process.env.INGEST_WEBHOOK_SECRET ?? process.env.CLAY_WEBHOOK_SECRET;
    if (!secret) {
      console.warn(
        "[Enrich] INGEST_WEBHOOK_SECRET not configured — rejecting all requests",
      );
      return NextResponse.json(
        { error: "Webhook authentication not configured" },
        { status: 401 },
      );
    }

    const apiKey = request.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      );
    }
    // Timing-safe comparison to prevent timing attacks
    const apiKeyBuf = Buffer.from(apiKey);
    const secretBuf = Buffer.from(secret);
    if (apiKeyBuf.length !== secretBuf.length || !crypto.timingSafeEqual(apiKeyBuf, secretBuf)) {
      return NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await parseJsonBody<any>(request);
    if (body instanceof Response) return body;

    // Batch mode: body is an array
    if (Array.isArray(body)) {
      if (body.length > 500) {
        return NextResponse.json(
          { error: "Batch size exceeds maximum of 500 items" },
          { status: 400 },
        );
      }

      const results: {
        email: string;
        created: boolean;
        updated: boolean;
        workspaceLinked?: boolean;
        listAdded?: boolean;
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

    // Object with items array — batch mode with top-level defaults
    if (body.items && Array.isArray(body.items)) {
      if (body.items.length > 500) {
        return NextResponse.json(
          { error: "Batch size exceeds maximum of 500 items" },
          { status: 400 },
        );
      }

      const defaults: Record<string, unknown> = {};
      if (body.workspace) defaults.workspace = body.workspace;
      if (body.targetListId ?? body.target_list_id) {
        defaults.targetListId = body.targetListId ?? body.target_list_id;
      }

      const results: {
        email: string;
        created: boolean;
        updated: boolean;
        workspaceLinked?: boolean;
        listAdded?: boolean;
        error?: string;
      }[] = [];
      let totalCreated = 0;
      let totalUpdated = 0;

      for (const item of body.items) {
        const merged = { ...defaults, ...item };
        const result = await enrichPerson(normalizePayload(merged));
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
