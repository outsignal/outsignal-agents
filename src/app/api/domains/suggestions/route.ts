import { NextRequest, NextResponse } from "next/server";
import {
  verifyAdminSession,
  ADMIN_COOKIE_NAME,
} from "@/lib/admin-auth";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PREFIXES = ["get", "try", "use", "hello", "meet", "with"];
const SUFFIXES = ["hq", "team", "group"];
const TLDS = [".com", ".co.uk", ".io", ".co", ".agency", ".uk"];

/** Per-domain timeout when calling Porkbun (ms) */
const PORKBUN_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBaseName(website: string): string {
  let cleaned = website.replace(/^https?:\/\//, "").replace(/^www\./, "");
  cleaned = cleaned.split("/")[0];
  cleaned = cleaned
    .replace(/\.(com|co\.uk|co|io|net|org|uk|agency|dev|ai)$/, "")
    .replace(/\.$/, "");
  return cleaned.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function generateCandidates(website: string): string[] {
  const base = extractBaseName(website);
  if (!base || base.length < 2) return [];

  const suggestions = new Set<string>();

  // Prefix + base + TLD
  for (const prefix of PREFIXES) {
    for (const tld of TLDS) {
      suggestions.add(`${prefix}${base}${tld}`);
    }
  }

  // Base + suffix + TLD
  for (const suffix of SUFFIXES) {
    for (const tld of TLDS) {
      suggestions.add(`${base}${suffix}${tld}`);
    }
  }

  // Base with different TLDs
  for (const tld of TLDS) {
    suggestions.add(`${base}${tld}`);
  }

  // Remove the actual website domain if present
  const actualDomain = website
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .toLowerCase();
  suggestions.delete(actualDomain);

  return Array.from(suggestions);
}

// ---------------------------------------------------------------------------
// Porkbun availability check
// ---------------------------------------------------------------------------

async function checkAvailability(
  domain: string,
  apiKey: string,
  secretApiKey: string,
): Promise<{ domain: string; available: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PORKBUN_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.porkbun.com/api/json/v3/domain/checkAvailability/${domain}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: apiKey, secretapikey: secretApiKey }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      console.warn(`[domain-suggestions] Porkbun returned ${res.status} for ${domain}`);
      return { domain, available: false };
    }

    const data = await res.json();
    // Porkbun returns { status: "SUCCESS", avail: true/false } or similar
    const avail =
      data.status === "SUCCESS" &&
      (data.avail === true ||
        data.avail === "yes" ||
        String(data.available).toLowerCase() === "yes" ||
        data.available === true);
    return { domain, available: avail };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      console.warn(`[domain-suggestions] Timeout checking ${domain}`);
    } else {
      console.warn(`[domain-suggestions] Error checking ${domain}:`, err);
    }
    return { domain, available: false };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Auth check
  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookie || !verifyAdminSession(cookie)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const website = request.nextUrl.searchParams.get("website");
  if (!website || website.trim().length < 2) {
    return NextResponse.json(
      { error: "Missing or invalid 'website' query parameter" },
      { status: 400 },
    );
  }

  const apiKey = process.env.PORKBUN_API_KEY;
  const secretApiKey = process.env.PORKBUN_SECRET_KEY;

  if (!apiKey || !secretApiKey) {
    // Fallback: return suggestions without availability check
    console.warn("[domain-suggestions] PORKBUN_API_KEY or PORKBUN_SECRET_KEY not set — returning unchecked suggestions");
    const candidates = generateCandidates(website).slice(0, 20);
    return NextResponse.json({
      domains: candidates.map((d) => ({ domain: d, available: null })),
      checked: false,
    });
  }

  const candidates = generateCandidates(website);

  // Check all domains in parallel
  const results = await Promise.allSettled(
    candidates.map((domain) => checkAvailability(domain, apiKey, secretApiKey)),
  );

  const available: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.available) {
      available.push(result.value.domain);
    }
  }

  return NextResponse.json({ domains: available, checked: true });
}

// Also support checking a single custom domain
export async function POST(request: NextRequest) {
  // Auth check
  const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookie || !verifyAdminSession(cookie)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { domain?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const domain = body.domain?.trim().toLowerCase();
  if (!domain || !domain.includes(".")) {
    return NextResponse.json(
      { error: "Missing or invalid 'domain' in request body" },
      { status: 400 },
    );
  }

  const apiKey = process.env.PORKBUN_API_KEY;
  const secretApiKey = process.env.PORKBUN_SECRET_KEY;

  if (!apiKey || !secretApiKey) {
    return NextResponse.json({ domain, available: null, checked: false });
  }

  const result = await checkAvailability(domain, apiKey, secretApiKey);
  return NextResponse.json({ domain: result.domain, available: result.available, checked: true });
}
