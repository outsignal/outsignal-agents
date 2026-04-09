/**
 * AI Ark Export People webhook handler.
 *
 * Receives async results from AI Ark's "Export People with Email" endpoint.
 * People arrive with verified emails (BounceBan-verified by AI Ark).
 *
 * Query params:
 *   - runId: the discoveryRunId to associate results with
 *
 * The webhook payload schema is not fully documented — this handler is
 * defensive, logs the full payload for debugging, and stores raw data
 * for potential reprocessing.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const maxDuration = 60;

/**
 * Extract an array of people from the webhook payload.
 * AI Ark may structure this as:
 *   - { content: [...] }   (same as search response)
 *   - { data: [...] }
 *   - { results: [...] }
 *   - direct array [...]
 *
 * We try all known shapes defensively.
 */
function extractPeople(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.content)) return obj.content;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.results)) return obj.results;
    // Check nested — e.g. { response: { content: [...] } }
    if (obj.response && typeof obj.response === "object") {
      const resp = obj.response as Record<string, unknown>;
      if (Array.isArray(resp.content)) return resp.content;
      if (Array.isArray(resp.data)) return resp.data;
    }
  }
  return [];
}

/**
 * Map a single person record from the export payload to DiscoveredPerson fields.
 * Handles both nested (search-style) and flat response shapes.
 */
function mapExportPerson(raw: unknown): {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  linkedinUrl: string | null;
  phone: string | null;
  location: string | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  // Handle nested AI Ark structure (profile/link/company/location sub-objects)
  const profile = (p.profile as Record<string, unknown> | undefined) ?? {};
  const link = (p.link as Record<string, unknown> | undefined) ?? {};
  const companySummary = (() => {
    const comp = p.company as Record<string, unknown> | undefined;
    if (!comp) return {};
    return (comp.summary as Record<string, unknown> | undefined) ?? comp;
  })();
  const companyLink = (() => {
    const comp = p.company as Record<string, unknown> | undefined;
    if (!comp) return {};
    return (comp.link as Record<string, unknown> | undefined) ?? {};
  })();
  const loc = (p.location as Record<string, unknown> | undefined) ?? {};

  // Extract email — could be top-level, in profile, or in an email object
  let email: string | null = null;
  if (typeof p.email === "string" && p.email.includes("@")) {
    email = p.email;
  } else if (typeof profile.email === "string" && (profile.email as string).includes("@")) {
    email = profile.email as string;
  } else if (p.email && typeof p.email === "object") {
    const emailObj = p.email as Record<string, unknown>;
    if (typeof emailObj.value === "string" && (emailObj.value as string).includes("@")) {
      email = emailObj.value as string;
    } else if (typeof emailObj.email === "string" && (emailObj.email as string).includes("@")) {
      email = emailObj.email as string;
    }
  }

  // Flatten person data — try nested first, then flat fallbacks
  const firstName = asString(profile.first_name) ?? asString(p.firstName) ?? asString(p.first_name);
  const lastName = asString(profile.last_name) ?? asString(p.lastName) ?? asString(p.last_name);
  const jobTitle = asString(profile.title) ?? asString(p.title) ?? asString(p.jobTitle);
  const company = asString(companySummary.name) ?? asString(p.companyName) ?? asString(p.company);
  const companyDomain = asString(companyLink.domain) ?? asString(p.companyDomain) ?? asString(p.domain);
  const linkedinUrl = asString(link.linkedin) ?? asString(p.linkedinUrl) ?? asString(p.linkedin_url);
  const phone = asString(p.phone) ?? asString(profile.phone);
  const location = asString(loc.default) ?? asString(loc.country) ?? asString(p.location);

  // Must have at least a name or email to be useful
  if (!email && !firstName && !lastName && !linkedinUrl) return null;

  return { email, firstName, lastName, jobTitle, company, companyDomain, linkedinUrl, phone, location };
}

function asString(val: unknown): string | null {
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  return null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");

  if (!runId) {
    console.error("[aiark-export-webhook] Missing runId query parameter");
    return NextResponse.json({ error: "Missing runId" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    console.error("[aiark-export-webhook] Failed to parse JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Log full payload for debugging (schema is not fully documented)
  console.log(
    "[aiark-export-webhook] Received payload for runId:",
    runId,
    "keys:",
    payload && typeof payload === "object" ? Object.keys(payload as object) : typeof payload,
  );

  // Look up the discovery run to find the workspace
  const existingRecord = await prisma.discoveredPerson.findFirst({
    where: { discoveryRunId: runId },
    select: { workspaceSlug: true },
  });

  const workspaceSlug = existingRecord?.workspaceSlug;
  if (!workspaceSlug) {
    // No existing records for this runId — might be a brand new export.
    // Store the raw payload for reprocessing. Log and return 200 to avoid retries.
    console.warn(
      "[aiark-export-webhook] No existing DiscoveredPerson records found for runId:",
      runId,
      "— cannot determine workspace. Raw payload logged above.",
    );
    return NextResponse.json({ ok: true, warning: "runId not found — payload logged" });
  }

  const people = extractPeople(payload);
  console.log(`[aiark-export-webhook] Extracted ${people.length} people from payload for workspace ${workspaceSlug}`);

  if (people.length === 0) {
    // Might be a status update (e.g. COMPLETED with stats but no people)
    // or an error notification. Log and acknowledge.
    console.log("[aiark-export-webhook] No people in payload — may be status update");
    return NextResponse.json({ ok: true, peopleProcessed: 0 });
  }

  let staged = 0;
  let skipped = 0;

  // Process in batches of 50 to avoid overwhelming the DB
  const BATCH_SIZE = 50;
  for (let i = 0; i < people.length; i += BATCH_SIZE) {
    const batch = people.slice(i, i + BATCH_SIZE);
    const records: Array<{
      email: string | null;
      firstName: string | null;
      lastName: string | null;
      jobTitle: string | null;
      company: string | null;
      companyDomain: string | null;
      linkedinUrl: string | null;
      phone: string | null;
      location: string | null;
      discoverySource: string;
      workspaceSlug: string;
      discoveryRunId: string;
      rawResponse: string | null;
    }> = [];

    for (const rawPerson of batch) {
      const mapped = mapExportPerson(rawPerson);
      if (!mapped) {
        skipped++;
        continue;
      }

      // Build rawResponse JSON — include _aiarkExportVerified flag
      // so the enrichment waterfall knows to skip BounceBan verification
      const rawResponseObj: Record<string, unknown> = {
        _aiarkExportVerified: mapped.email != null, // email is pre-verified by AI Ark/BounceBan
        _sourcePayload: rawPerson,
      };

      records.push({
        ...mapped,
        discoverySource: "aiark-export",
        workspaceSlug,
        discoveryRunId: runId,
        rawResponse: JSON.stringify(rawResponseObj),
      });
    }

    if (records.length > 0) {
      const result = await prisma.discoveredPerson.createMany({
        data: records,
        skipDuplicates: false,
      });
      staged += result.count;
    }
  }

  console.log(
    `[aiark-export-webhook] Done: ${staged} staged, ${skipped} skipped (unmappable) for runId ${runId}`,
  );

  return NextResponse.json({ ok: true, peopleProcessed: staged, skipped });
}
