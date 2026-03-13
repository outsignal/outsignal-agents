/**
 * Clay CSV Import Script — Imports all Clay CSV exports into the database.
 *
 * Usage:
 *   npx tsx scripts/import-clay-csvs.ts                    # Import all CSVs
 *   npx tsx scripts/import-clay-csvs.ts --dry-run          # Parse and report without writing
 *   npx tsx scripts/import-clay-csvs.ts --file <name>      # Import a specific file
 *
 * Reads from: ~/Downloads/clay-export/
 * Target DB: PostgreSQL via Prisma (uses .env.local for DATABASE_URL)
 *
 * Performance: Uses batched INSERT ... ON CONFLICT (500 rows/batch) instead of
 * individual upserts. ~100-500x faster over remote Neon connections.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createReadStream, readdirSync } from "fs";
import { join, basename } from "path";
import { parse } from "csv-parse";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CSV_DIR = join(process.env.HOME ?? "~", "Downloads", "clay-export");
const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 1000;

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "hotmail.co.uk", "outlook.com", "live.com", "live.co.uk", "aol.com",
  "icloud.com", "me.com", "mac.com", "mail.com", "mail.ru", "msn.com",
  "protonmail.com", "proton.me", "ymail.com", "zoho.com", "gmx.com",
  "fastmail.com", "hey.com", "tutanota.com", "pm.me",
]);

// ---------------------------------------------------------------------------
// CUID generator (compatible with Prisma's @default(cuid()))
// ---------------------------------------------------------------------------

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
let cuidCounter = 0;

function cuid(): string {
  const timestamp = Date.now().toString(36);
  const count = (cuidCounter++).toString(36);
  const rand = randomBytes(8).reduce((acc, byte) => acc + BASE36[byte % 36], "");
  return `c${timestamp}${count}${rand}`;
}

// ---------------------------------------------------------------------------
// Company name normalization (duplicated from src/lib/normalize.ts to avoid
// path alias issues in scripts)
// ---------------------------------------------------------------------------

function normalizeCompanyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase()) return trimmed;

  const domainSuffixes = [".com", ".ai", ".io", ".co"];
  let suffix = "";
  let base = trimmed;
  for (const ds of domainSuffixes) {
    if (trimmed.toLowerCase().endsWith(ds)) {
      suffix = ds;
      base = trimmed.slice(0, -ds.length);
      break;
    }
  }

  const isAllLower = base === base.toLowerCase();
  const isAllUpper = base === base.toUpperCase();
  if (!isAllLower && !isAllUpper) return trimmed;

  const words = base.split(/(\s+)/);
  const titleCased = words.map((word) => {
    if (/^\s+$/.test(word)) return word;
    const parts = word.split(/(-)/);
    return parts
      .map((part) => {
        if (part === "-") return part;
        if (part.length === 0) return part;
        const firstAlpha = part.search(/[a-zA-Z]/);
        if (firstAlpha === -1) return part;
        return (
          part.slice(0, firstAlpha) +
          part.charAt(firstAlpha).toUpperCase() +
          part.slice(firstAlpha + 1).toLowerCase()
        );
      })
      .join("");
  });

  return titleCased.join("") + suffix;
}

// ---------------------------------------------------------------------------
// Workspace prefix mapping
// ---------------------------------------------------------------------------

const WORKSPACE_PREFIXES: [RegExp, string][] = [
  [/^Rise_/i, "rise"],
  [/^Yoop_/i, "yoopknows"],
  [/^BlankTag[-_]/i, "blanktag"],
  [/^Outsignal[-_]/i, "outsignal"],
  [/^MyAcq[-_]/i, "myacq"],
  [/^1210[-_]/i, "1210-solutions"],
  [/^Lime[-_]/i, "lime-recruitment"],
  [/^Covenco[-_]/i, "covenco"],
];

function getWorkspaceSlug(filename: string): string | null {
  for (const [re, slug] of WORKSPACE_PREFIXES) {
    if (re.test(filename)) return slug;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSV classification
// ---------------------------------------------------------------------------

const PEOPLE_INDICATORS = [
  "first name", "last name", "email", "first_name", "last_name",
  "work email", "final email", "full_name", "personal email",
  "personal_email", "find work email", "mergedemail",
];

const COMPANY_ONLY_INDICATORS = [
  "find companies", "domain", "account website", "company_number",
  "primary industry", "account name",
];

type CsvType = "people" | "company";

function classifyCsv(headers: string[]): CsvType {
  const lower = headers.map((h) => h.toLowerCase().trim());

  const hasPeople = PEOPLE_INDICATORS.some((ind) =>
    lower.some((h) => h.includes(ind))
  );

  if (hasPeople) return "people";

  const hasCompany = COMPANY_ONLY_INDICATORS.some((ind) =>
    lower.some((h) => h.includes(ind))
  );
  if (hasCompany) return "company";

  // Default: if it has person-like columns by name inspection
  return "company";
}

// ---------------------------------------------------------------------------
// Domain normalization
// ---------------------------------------------------------------------------

function normalizeDomain(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  let d = raw.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/\.$/, "");
  // Basic domain validation
  if (!d.includes(".") || d.length < 3) return null;
  return d;
}

// ---------------------------------------------------------------------------
// Field extraction helpers
// ---------------------------------------------------------------------------

function getFirst(row: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = row[key]?.trim();
    if (val && val.length > 0) return val;
  }
  return null;
}

/** Case-insensitive getFirst — finds the first matching key in the row */
function getFirstCI(row: Record<string, string>, lowerHeaders: Map<string, string>, ...searchKeys: string[]): string | null {
  for (const sk of searchKeys) {
    const actualKey = lowerHeaders.get(sk.toLowerCase());
    if (actualKey) {
      const val = row[actualKey]?.trim();
      if (val && val.length > 0) return val;
    }
  }
  return null;
}

function buildLowerHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (!map.has(lower)) {
      map.set(lower, h);
    }
  }
  return map;
}

function deriveCompanyDomain(email: string): string | null {
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const domain = parts[1].toLowerCase().trim();
  if (FREE_EMAIL_DOMAINS.has(domain)) return null;
  return domain;
}

function parseHeadcount(sizeStr: string | null): number | null {
  if (!sizeStr) return null;
  // Direct number
  const direct = parseInt(sizeStr, 10);
  if (!isNaN(direct) && sizeStr.match(/^\d+$/)) return direct;
  // Range like "51-200"
  const rangeMatch = sizeStr.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (rangeMatch) {
    return Math.round((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
  }
  // "10,000+" style
  const plusMatch = sizeStr.replace(/,/g, "").match(/(\d+)\+?/);
  if (plusMatch) return parseInt(plusMatch[1]);
  return null;
}

function mapCompanyType(raw: string | null): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("public")) return "public";
  if (lower.includes("private")) return "private";
  if (lower.includes("nonprofit") || lower.includes("non-profit")) return "nonprofit";
  if (lower.includes("government")) return "government";
  if (lower.includes("partnership")) return "partnership";
  if (lower.includes("sole") || lower.includes("self")) return "sole-proprietor";
  if (lower.includes("education")) return "education";
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Person known fields (to separate from enrichmentData)
// ---------------------------------------------------------------------------

const PERSON_MAPPED_KEYS = new Set([
  // All header names that map to Person model fields (lowercase)
  "email", "work email", "personal email", "final email", "personal_email",
  "first name", "first_name", "original_first_name", "forename",
  "last name", "last_name", "original_last_name", "surname",
  "company", "companyname", "company name", "organization_name", "current_company",
  "company domain", "company_domain", "organization_website_url", "organization_primary_domain",
  "root domain", "website", "domain",
  "job title", "title", "original_current_company_position", "current_company_position",
  "linkedin profile", "personal linkedin", "linkedin_url", "profile_url", "linkedin",
  "linkedin profile url", "linked in profile url linkedin profile url",
  "location", "location_name", "person address", "country",
  "phone", "company phone",
  "primary industry", "industry", "current_company_industry",
  "full name", "full_name", "name", "headline",
  // Company fields extracted as side effect
  "description", "company summary", "company linkedin", "organization_linkedin_url",
  "# employees", "estimated_num_employees", "size",
  "annual revenue", "latest funding", "latest funding amount", "last raised at",
  "type", "technologies", "organization_technologies",
  "company address", "company city", "company state", "company country", "company email",
  // Columns we explicitly skip (Clay internal)
  "find companies", "find people", "find jobs", "find work email",
  "find work email (2)", "find work email (3)", "find work email (4)",
  "find work email (5)", "find work email (6)", "find work email (7)",
  "find decision makers & sales leaders", "work email waterfall",
  "update people search", "write to other table", "person enrichment api",
  "person enrichment api (2)", "company enrichment", "import lead(s) to campaign",
  "create or update lead", "sync leads to campaign", "send table data",
  "send table data (2)", "lookup multiple rows in other table",
  "lookup multiple rows in other table (2)",
]);

const COMPANY_MAPPED_KEYS = new Set([
  "find companies", "name", "account name", "company name", "companyname",
  "company_name", "current_legal_or_registered_name", "organization_name",
  "domain", "account website (domain)", "company domain", "organization_website_url",
  "primary industry", "industry", "company_category",
  "# employees", "estimated_num_employees", "size",
  "location", "company address", "address", "country",
  "website", "linkedin url", "company linkedin", "organization_linkedin_url",
  "description", "company summary", "annual revenue", "revenue",
  "type", "technologies", "organization_technologies",
  // Clay internal columns to skip
  "update people search", "write to other table", "write to other table (2)",
  "lookup multiple rows in other table", "lookup multiple rows in other table (2)",
  "company enrichment", "total cost to aiprovider", "send table data",
  "send table data (2)",
]);

// Headers that are Clay internals — skip entirely from enrichmentData
const SKIP_ENRICHMENT_PATTERNS = [
  /^update people search/i,
  /^write to other table/i,
  /^lookup multiple rows/i,
  /^person enrichment api/i,
  /^company enrichment/i,
  /^import lead.*campaign/i,
  /^create or update lead/i,
  /^sync leads to campaign/i,
  /^send table data/i,
  /^find work email/i,
  /^find decision makers/i,
  /^work email waterfall/i,
  /^total cost/i,
  /^cost \(no/i,
];

function shouldSkipEnrichment(header: string): boolean {
  return SKIP_ENRICHMENT_PATTERNS.some((p) => p.test(header));
}

// ---------------------------------------------------------------------------
// Extract person data from a CSV row
// ---------------------------------------------------------------------------

interface PersonData {
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  location: string | null;
  phone: string | null;
  vertical: string | null;
  enrichmentData: Record<string, unknown>;
}

function extractPerson(
  row: Record<string, string>,
  headers: string[],
  lm: Map<string, string>,
  workspaceVertical: string | null,
): PersonData | null {
  // Find email — try work email first, then personal, then generic
  const email = (
    getFirstCI(row, lm, "Work Email", "email", "Final Email", "mergedEmail", "Personal Email", "personal_email", "Find work email")
  )?.toLowerCase().trim() ?? null;

  if (!email || !email.includes("@")) return null;

  const firstName = getFirstCI(row, lm,
    "First Name", "first_name", "original_first_name", "Forename"
  );
  const lastName = getFirstCI(row, lm,
    "Last Name", "last_name", "original_last_name", "Surname"
  );
  const company = getFirstCI(row, lm,
    "Company", "CompanyName", "Company Name", "organization_name", "current_company", "original_current_company"
  );
  let companyDomain = normalizeDomain(
    getFirstCI(row, lm,
      "Company Domain", "company_domain", "organization_website_url",
      "organization_primary_domain", "Root Domain", "Domain", "Website FINAL", "Website", "Official Domain"
    )
  );
  if (!companyDomain) {
    companyDomain = deriveCompanyDomain(email);
  }
  const jobTitle = getFirstCI(row, lm,
    "Job Title", "title", "original_current_company_position", "current_company_position"
  );
  const linkedinUrl = getFirstCI(row, lm,
    "LinkedIn Profile", "Personal LinkedIn", "linkedin_url", "profile_url",
    "LinkedIn", "LinkedIn Profile URL", "Linked In Profile URL linkedin Profile Url"
  );
  const location = getFirstCI(row, lm,
    "Location", "location_name", "Person Address"
  );
  const phone = getFirstCI(row, lm, "Phone");
  const vertical = getFirstCI(row, lm,
    "Primary Industry", "industry", "current_company_industry"
  ) ?? workspaceVertical;

  // Collect unmapped fields into enrichmentData
  const enrichmentData: Record<string, unknown> = {};
  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (PERSON_MAPPED_KEYS.has(lower)) continue;
    if (shouldSkipEnrichment(h)) continue;
    const val = row[h]?.trim();
    if (val && val.length > 0) {
      enrichmentData[h] = val;
    }
  }

  return {
    email,
    firstName,
    lastName,
    company: company ? normalizeCompanyName(company) : null,
    companyDomain,
    jobTitle,
    linkedinUrl,
    location,
    phone,
    vertical,
    enrichmentData,
  };
}

// ---------------------------------------------------------------------------
// Extract company data from a CSV row
// ---------------------------------------------------------------------------

interface CompanyData {
  domain: string;
  name: string;
  industry: string | null;
  headcount: number | null;
  location: string | null;
  website: string | null;
  linkedinUrl: string | null;
  description: string | null;
  revenue: string | null;
  yearFounded: number | null;
  companyType: string | null;
  techStack: string | null;
  enrichmentData: Record<string, unknown>;
}

function extractCompany(
  row: Record<string, string>,
  headers: string[],
  lm: Map<string, string>,
): CompanyData | null {
  const domain = normalizeDomain(
    getFirstCI(row, lm,
      "Domain", "Account Website (Domain)", "Company Domain", "organization_website_url",
      "organization_primary_domain", "Website", "CompanyURL"
    )
  );
  if (!domain) return null;

  const rawName = getFirstCI(row, lm,
    "Name", "Account Name", "Company Name", "CompanyName", "company_name",
    "current_legal_or_registered_name", "organization_name"
  );
  const name = rawName ? normalizeCompanyName(rawName) : domain;

  const industry = getFirstCI(row, lm, "Primary Industry", "industry", "company_category");
  const sizeStr = getFirstCI(row, lm, "# Employees", "estimated_num_employees", "Size");
  const headcount = parseHeadcount(sizeStr);
  const location = getFirstCI(row, lm, "Location", "Company Address", "address");
  const linkedinUrl = getFirstCI(row, lm, "LinkedIn URL", "Company LinkedIn", "organization_linkedin_url");
  const description = getFirstCI(row, lm, "Description", "Company Summary");
  const revenue = getFirstCI(row, lm, "Annual Revenue", "revenue");
  const typeRaw = getFirstCI(row, lm, "Type");
  const companyType = mapCompanyType(typeRaw);

  const techRaw = getFirstCI(row, lm, "Technologies", "organization_technologies");
  let techStack: string | null = null;
  if (techRaw) {
    // Parse comma-separated into JSON array
    const arr = techRaw.split(",").map((t) => t.trim()).filter(Boolean);
    techStack = JSON.stringify(arr);
  }

  const yearRaw = getFirstCI(row, lm, "Year Founded", "year_founded");
  const yearFounded = yearRaw ? parseInt(yearRaw, 10) || null : null;

  const website = `https://${domain}`;

  // Collect unmapped fields
  const enrichmentData: Record<string, unknown> = {};
  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (COMPANY_MAPPED_KEYS.has(lower)) continue;
    if (shouldSkipEnrichment(h)) continue;
    const val = row[h]?.trim();
    if (val && val.length > 0) {
      enrichmentData[h] = val;
    }
  }

  return {
    domain,
    name,
    industry,
    headcount,
    location,
    website,
    linkedinUrl,
    description,
    revenue,
    yearFounded,
    companyType,
    techStack,
    enrichmentData,
  };
}

// ---------------------------------------------------------------------------
// Extract company data from Companies House rows (MyAcq_DataLedger etc.)
// ---------------------------------------------------------------------------

function extractCompaniesHouse(
  row: Record<string, string>,
  headers: string[],
  lm: Map<string, string>,
): CompanyData | null {
  // Companies House rows may have a CompanyURL or domain
  const domain = normalizeDomain(
    getFirstCI(row, lm, "CompanyURL", "Domain", "Website")
  );
  if (!domain) return null;

  const rawName = getFirstCI(row, lm,
    "company_name", "current_legal_or_registered_name", "Company Name"
  );
  const name = rawName ? normalizeCompanyName(rawName) : domain;

  const industry = getFirstCI(row, lm, "company_category");

  // All unmapped → enrichmentData (includes company_number, SIC codes, officers, etc.)
  const enrichmentData: Record<string, unknown> = {};
  for (const h of headers) {
    const lower = h.toLowerCase().trim();
    if (["companyurl", "domain", "website", "company_name",
         "current_legal_or_registered_name"].includes(lower)) continue;
    if (shouldSkipEnrichment(h)) continue;
    const val = row[h]?.trim();
    if (val && val.length > 0) {
      enrichmentData[h] = val;
    }
  }

  return {
    domain,
    name,
    industry,
    headcount: null,
    location: getFirstCI(row, lm, "address"),
    website: `https://${domain}`,
    linkedinUrl: null,
    description: null,
    revenue: null,
    yearFounded: null,
    companyType: null,
    techStack: null,
    enrichmentData,
  };
}

// ---------------------------------------------------------------------------
// Check if a file is a Companies House export
// ---------------------------------------------------------------------------

function isCompaniesHouse(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  return lower.includes("company_number") && lower.includes("sic1");
}

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------

interface FileStats {
  filename: string;
  type: CsvType | "companies_house";
  workspace: string | null;
  rowsProcessed: number;
  peopleCreated: number;
  peopleUpdated: number;
  companiesCreated: number;
  companiesUpdated: number;
  skipped: number;
  errors: number;
}

interface TotalStats {
  files: number;
  rowsProcessed: number;
  peopleCreated: number;
  peopleUpdated: number;
  companiesCreated: number;
  companiesUpdated: number;
  skipped: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Batch flush: People (raw SQL INSERT ... ON CONFLICT)
// ---------------------------------------------------------------------------

const PERSON_COLS = 16; // number of columns per person row

async function flushPeopleBatch(
  people: PersonData[],
  workspaceSlug: string | null,
  stats: FileStats,
): Promise<void> {
  if (people.length === 0) return;

  // Deduplicate by email within this batch (keep last occurrence)
  const deduped = new Map<string, PersonData>();
  for (const p of people) {
    deduped.set(p.email, p);
  }
  const uniquePeople = Array.from(deduped.values());

  const now = new Date();
  const params: unknown[] = [];
  const valueTuples: string[] = [];

  for (let i = 0; i < uniquePeople.length; i++) {
    const p = uniquePeople[i];
    const offset = i * PERSON_COLS;
    const extraJson = Object.keys(p.enrichmentData).length > 0
      ? JSON.stringify(p.enrichmentData)
      : null;

    params.push(
      cuid(),           // $1 id
      p.email,          // $2 email
      p.firstName,      // $3 firstName
      p.lastName,       // $4 lastName
      p.company,        // $5 company
      p.companyDomain,  // $6 companyDomain
      p.jobTitle,       // $7 jobTitle
      p.phone,          // $8 phone
      p.linkedinUrl,    // $9 linkedinUrl
      p.location,       // $10 location
      p.vertical,       // $11 vertical
      "clay",           // $12 source
      "new",            // $13 status
      extraJson,        // $14 enrichmentData
      now,              // $15 createdAt
      now,              // $16 updatedAt
    );

    const placeholders = Array.from({ length: PERSON_COLS }, (_, j) => `$${offset + j + 1}`);
    valueTuples.push(`(${placeholders.join(", ")})`);
  }

  const sql = `
    INSERT INTO "Lead" (id, email, "firstName", "lastName", company, "companyDomain", "jobTitle", phone, "linkedinUrl", location, vertical, source, status, "enrichmentData", "createdAt", "updatedAt")
    VALUES ${valueTuples.join(", ")}
    ON CONFLICT (email) DO UPDATE SET
      "firstName" = COALESCE("Lead"."firstName", EXCLUDED."firstName"),
      "lastName" = COALESCE("Lead"."lastName", EXCLUDED."lastName"),
      "jobTitle" = COALESCE("Lead"."jobTitle", EXCLUDED."jobTitle"),
      company = COALESCE("Lead".company, EXCLUDED.company),
      phone = COALESCE("Lead".phone, EXCLUDED.phone),
      "companyDomain" = COALESCE(EXCLUDED."companyDomain", "Lead"."companyDomain"),
      "linkedinUrl" = COALESCE(EXCLUDED."linkedinUrl", "Lead"."linkedinUrl"),
      location = COALESCE(EXCLUDED.location, "Lead".location),
      vertical = COALESCE(EXCLUDED.vertical, "Lead".vertical),
      "enrichmentData" = CASE
        WHEN "Lead"."enrichmentData" IS NOT NULL AND EXCLUDED."enrichmentData" IS NOT NULL
        THEN ("Lead"."enrichmentData"::jsonb || EXCLUDED."enrichmentData"::jsonb)::text
        ELSE COALESCE(EXCLUDED."enrichmentData", "Lead"."enrichmentData")
      END,
      "updatedAt" = NOW()
  `;

  // We can't easily use RETURNING with $executeRawUnsafe, so use $queryRawUnsafe
  const results: Array<{ id: string; email: string; created: boolean }> = await prisma.$queryRawUnsafe(
    sql + ` RETURNING id, email, (xmax = 0) AS created`,
    ...params,
  );

  // Count creates vs updates
  for (const r of results) {
    if (r.created) {
      stats.peopleCreated++;
    } else {
      stats.peopleUpdated++;
    }
  }

  // Build email→id map from results
  const emailToId = new Map<string, string>();
  for (const r of results) {
    emailToId.set(r.email, r.id);
  }

  // Insert PersonWorkspace links
  if (workspaceSlug) {
    await flushWorkspaceLinks(emailToId, workspaceSlug);
  }

  // Side-effect: create company stubs for any new companyDomains
  const companyStubs = new Map<string, { domain: string; name: string; industry: string | null; location: string | null }>();
  for (const p of uniquePeople) {
    if (p.companyDomain && !companyStubs.has(p.companyDomain)) {
      companyStubs.set(p.companyDomain, {
        domain: p.companyDomain,
        name: p.company ?? p.companyDomain,
        industry: p.vertical,
        location: p.location,
      });
    }
  }

  if (companyStubs.size > 0) {
    await flushCompanyStubs(Array.from(companyStubs.values()), stats);
  }
}

// ---------------------------------------------------------------------------
// Batch flush: Company stubs (side-effect from people import)
// INSERT ... ON CONFLICT DO NOTHING — just creates missing companies
// ---------------------------------------------------------------------------

async function flushCompanyStubs(
  stubs: Array<{ domain: string; name: string; industry: string | null; location: string | null }>,
  stats: FileStats,
): Promise<void> {
  if (stubs.length === 0) return;

  const COLS = 6;
  const now = new Date();
  const params: unknown[] = [];
  const valueTuples: string[] = [];

  for (let i = 0; i < stubs.length; i++) {
    const s = stubs[i];
    const offset = i * COLS;
    params.push(
      cuid(),         // id
      s.domain,       // domain
      s.name,         // name
      s.industry,     // industry
      s.location,     // location
      now,            // createdAt
    );
    const placeholders = Array.from({ length: COLS }, (_, j) => `$${offset + j + 1}`);
    valueTuples.push(`(${placeholders.join(", ")})`);
  }

  const sql = `
    INSERT INTO "Company" (id, domain, name, industry, location, "createdAt")
    VALUES ${valueTuples.join(", ")}
    ON CONFLICT (domain) DO NOTHING
  `;

  try {
    const inserted = await prisma.$executeRawUnsafe(sql, ...params);
    stats.companiesCreated += inserted;
  } catch (err) {
    // Non-critical — log and continue
    console.error(`    Warning: company stub batch error: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Batch flush: PersonWorkspace links
// ---------------------------------------------------------------------------

async function flushWorkspaceLinks(
  emailToId: Map<string, string>,
  workspaceSlug: string,
): Promise<void> {
  if (emailToId.size === 0) return;

  const COLS2 = 5;
  const now = new Date();
  const params2: unknown[] = [];
  const valueTuples2: string[] = [];
  let j = 0;
  for (const [_email, personId] of emailToId) {
    const offset = j * COLS2;
    params2.push(
      cuid(),         // id
      personId,       // leadId
      workspaceSlug,  // workspace
      "active",       // status
      now,            // createdAt
    );
    const placeholders = Array.from({ length: COLS2 }, (_, k) => `$${offset + k + 1}`);
    valueTuples2.push(`(${placeholders.join(", ")})`);
    j++;
  }

  const sql2 = `
    INSERT INTO "LeadWorkspace" (id, "leadId", workspace, status, "createdAt")
    VALUES ${valueTuples2.join(", ")}
    ON CONFLICT ("leadId", workspace) DO NOTHING
  `;

  try {
    await prisma.$executeRawUnsafe(sql2, ...params2);
  } catch (err) {
    // Workspace may not exist or other constraint — log and continue
    console.error(`    Warning: workspace link batch error: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Batch flush: Companies (primary import, raw SQL INSERT ... ON CONFLICT)
// ---------------------------------------------------------------------------

const COMPANY_COLS = 16;

async function flushCompanyBatch(
  companies: CompanyData[],
  stats: FileStats,
): Promise<void> {
  if (companies.length === 0) return;

  // Deduplicate by domain within this batch (keep last occurrence)
  const deduped = new Map<string, CompanyData>();
  for (const c of companies) {
    deduped.set(c.domain, c);
  }
  const uniqueCompanies = Array.from(deduped.values());

  const now = new Date();
  const params: unknown[] = [];
  const valueTuples: string[] = [];

  for (let i = 0; i < uniqueCompanies.length; i++) {
    const c = uniqueCompanies[i];
    const offset = i * COMPANY_COLS;
    const extraJson = Object.keys(c.enrichmentData).length > 0
      ? JSON.stringify(c.enrichmentData)
      : null;

    params.push(
      cuid(),           // $1 id
      c.domain,         // $2 domain
      c.name,           // $3 name
      c.industry,       // $4 industry
      c.headcount,      // $5 headcount
      c.location,       // $6 location
      c.website,        // $7 website
      c.linkedinUrl,    // $8 linkedinUrl
      c.description,    // $9 description
      c.revenue,        // $10 revenue
      c.yearFounded,    // $11 yearFounded
      c.companyType,    // $12 companyType
      c.techStack,      // $13 techStack
      extraJson,        // $14 enrichmentData
      now,              // $15 createdAt
      now,              // $16 updatedAt
    );

    const placeholders = Array.from({ length: COMPANY_COLS }, (_, j) => `$${offset + j + 1}`);
    valueTuples.push(`(${placeholders.join(", ")})`);
  }

  const sql = `
    INSERT INTO "Company" (id, domain, name, industry, headcount, location, website, "linkedinUrl", description, revenue, "yearFounded", "companyType", "techStack", "enrichmentData", "createdAt", "updatedAt")
    VALUES ${valueTuples.join(", ")}
    ON CONFLICT (domain) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, "Company".name),
      industry = COALESCE(EXCLUDED.industry, "Company".industry),
      headcount = COALESCE(EXCLUDED.headcount, "Company".headcount),
      location = COALESCE(EXCLUDED.location, "Company".location),
      website = COALESCE(EXCLUDED.website, "Company".website),
      "linkedinUrl" = COALESCE(EXCLUDED."linkedinUrl", "Company"."linkedinUrl"),
      description = COALESCE(EXCLUDED.description, "Company".description),
      revenue = COALESCE(EXCLUDED.revenue, "Company".revenue),
      "yearFounded" = COALESCE(EXCLUDED."yearFounded", "Company"."yearFounded"),
      "companyType" = COALESCE(EXCLUDED."companyType", "Company"."companyType"),
      "techStack" = COALESCE(EXCLUDED."techStack", "Company"."techStack"),
      "enrichmentData" = CASE
        WHEN "Company"."enrichmentData" IS NOT NULL AND EXCLUDED."enrichmentData" IS NOT NULL
        THEN ("Company"."enrichmentData"::jsonb || EXCLUDED."enrichmentData"::jsonb)::text
        ELSE COALESCE(EXCLUDED."enrichmentData", "Company"."enrichmentData")
      END,
      "updatedAt" = NOW()
  `;

  const results: Array<{ id: string; domain: string; created: boolean }> = await prisma.$queryRawUnsafe(
    sql + ` RETURNING id, domain, (xmax = 0) AS created`,
    ...params,
  );

  for (const r of results) {
    if (r.created) {
      stats.companiesCreated++;
    } else {
      stats.companiesUpdated++;
    }
  }
}

// ---------------------------------------------------------------------------
// Process a single CSV file
// ---------------------------------------------------------------------------

async function processFile(filePath: string, dryRun: boolean): Promise<FileStats> {
  const filename = basename(filePath);
  const workspaceSlug = getWorkspaceSlug(filename);

  // Read headers first to classify
  const headers = await readHeaders(filePath);
  const companiesHouse = isCompaniesHouse(headers);
  const csvType = companiesHouse ? "company" : classifyCsv(headers);
  const lm = buildLowerHeaderMap(headers);

  const stats: FileStats = {
    filename,
    type: companiesHouse ? "companies_house" : csvType,
    workspace: workspaceSlug,
    rowsProcessed: 0,
    peopleCreated: 0,
    peopleUpdated: 0,
    companiesCreated: 0,
    companiesUpdated: 0,
    skipped: 0,
    errors: 0,
  };

  console.log(`\n--- Processing: ${filename}`);
  console.log(`    Type: ${stats.type} | Workspace: ${workspaceSlug ?? "(none)"} | Columns: ${headers.length}`);

  // Stream-parse the CSV
  const parser = createReadStream(filePath, { encoding: "utf-8" })
    .pipe(parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
      trim: true,
    }));

  // Collect parsed data into batches
  let peopleBatch: PersonData[] = [];
  let companyBatch: CompanyData[] = [];
  let rowCount = 0;

  for await (const row of parser) {
    rowCount++;
    stats.rowsProcessed++;

    try {
      if (csvType === "people") {
        const person = extractPerson(row as Record<string, string>, headers, lm, null);
        if (!person) {
          stats.skipped++;
        } else {
          peopleBatch.push(person);
        }

        if (peopleBatch.length >= BATCH_SIZE) {
          if (!dryRun) {
            await flushPeopleBatch(peopleBatch, workspaceSlug, stats);
          } else {
            stats.peopleCreated += peopleBatch.length;
          }
          peopleBatch = [];
        }
      } else {
        const company = companiesHouse
          ? extractCompaniesHouse(row as Record<string, string>, headers, lm)
          : extractCompany(row as Record<string, string>, headers, lm);
        if (!company) {
          stats.skipped++;
        } else {
          companyBatch.push(company);
        }

        if (companyBatch.length >= BATCH_SIZE) {
          if (!dryRun) {
            await flushCompanyBatch(companyBatch, stats);
          } else {
            stats.companiesCreated += companyBatch.length;
          }
          companyBatch = [];
        }
      }
    } catch (err) {
      stats.errors++;
      if (stats.errors <= 5) {
        console.error(`    Error on row ${stats.rowsProcessed}: ${(err as Error).message}`);
      }
    }

    if (stats.rowsProcessed > 0 && stats.rowsProcessed % PROGRESS_INTERVAL === 0) {
      console.log(`    ... ${stats.rowsProcessed} rows (${stats.peopleCreated}p+/${stats.peopleUpdated}pu/${stats.companiesCreated}c+/${stats.companiesUpdated}cu/${stats.skipped}skip/${stats.errors}err)`);
    }
  }

  // Flush remaining batches
  try {
    if (peopleBatch.length > 0) {
      if (!dryRun) {
        await flushPeopleBatch(peopleBatch, workspaceSlug, stats);
      } else {
        stats.peopleCreated += peopleBatch.length;
      }
    }
    if (companyBatch.length > 0) {
      if (!dryRun) {
        await flushCompanyBatch(companyBatch, stats);
      } else {
        stats.companiesCreated += companyBatch.length;
      }
    }
  } catch (err) {
    stats.errors++;
    console.error(`    Error flushing final batch: ${(err as Error).message}`);
  }

  console.log(`    Done: ${stats.rowsProcessed} rows | People: +${stats.peopleCreated}/~${stats.peopleUpdated} | Companies: +${stats.companiesCreated}/~${stats.companiesUpdated} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);

  return stats;
}

// ---------------------------------------------------------------------------
// Read CSV headers
// ---------------------------------------------------------------------------

function readHeaders(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const parser = createReadStream(filePath, { encoding: "utf-8" })
      .pipe(parse({
        to_line: 1,
        bom: true,
        trim: true,
      }));

    parser.on("data", (row: string[]) => {
      resolve(row);
      parser.destroy();
    });
    parser.on("error", reject);
    parser.on("end", () => resolve([]));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileIdx = args.indexOf("--file");
  const specificFile = fileIdx !== -1 ? args[fileIdx + 1] : null;

  if (dryRun) {
    console.log("=== DRY RUN MODE — no database writes ===\n");
  }

  console.log(`Batch size: ${BATCH_SIZE} rows per INSERT statement`);

  // Discover CSV files
  let files: string[];
  if (specificFile) {
    const fullPath = specificFile.includes("/")
      ? specificFile
      : join(CSV_DIR, specificFile);
    files = [fullPath];
    console.log(`Processing single file: ${basename(fullPath)}`);
  } else {
    const entries = readdirSync(CSV_DIR).filter((f) => f.endsWith(".csv")).sort();
    files = entries.map((f) => join(CSV_DIR, f));
    console.log(`Found ${files.length} CSV files in ${CSV_DIR}`);
  }

  // Validate workspaces exist
  if (!dryRun) {
    const workspaces = await prisma.workspace.findMany({ select: { slug: true } });
    const slugs = new Set(workspaces.map((w) => w.slug));
    console.log(`Database workspaces: ${[...slugs].join(", ")}`);
  }

  const allStats: FileStats[] = [];
  const startTime = Date.now();

  for (const file of files) {
    try {
      const fileStart = Date.now();
      const stats = await processFile(file, dryRun);
      const elapsed = ((Date.now() - fileStart) / 1000).toFixed(1);
      console.log(`    Time: ${elapsed}s`);
      allStats.push(stats);
    } catch (err) {
      console.error(`\nFATAL error processing ${basename(file)}: ${(err as Error).message}`);
      allStats.push({
        filename: basename(file),
        type: "company",
        workspace: null,
        rowsProcessed: 0,
        peopleCreated: 0,
        peopleUpdated: 0,
        companiesCreated: 0,
        companiesUpdated: 0,
        skipped: 0,
        errors: 1,
      });
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const totals: TotalStats = {
    files: allStats.length,
    rowsProcessed: 0,
    peopleCreated: 0,
    peopleUpdated: 0,
    companiesCreated: 0,
    companiesUpdated: 0,
    skipped: 0,
    errors: 0,
  };

  for (const s of allStats) {
    totals.rowsProcessed += s.rowsProcessed;
    totals.peopleCreated += s.peopleCreated;
    totals.peopleUpdated += s.peopleUpdated;
    totals.companiesCreated += s.companiesCreated;
    totals.companiesUpdated += s.companiesUpdated;
    totals.skipped += s.skipped;
    totals.errors += s.errors;
  }

  console.log("\n" + "=".repeat(70));
  console.log("IMPORT SUMMARY");
  console.log("=".repeat(70));
  console.log(`Files processed:     ${totals.files}`);
  console.log(`Total rows:          ${totals.rowsProcessed.toLocaleString()}`);
  console.log(`People created:      ${totals.peopleCreated.toLocaleString()}`);
  console.log(`People updated:      ${totals.peopleUpdated.toLocaleString()}`);
  console.log(`Companies created:   ${totals.companiesCreated.toLocaleString()}`);
  console.log(`Companies updated:   ${totals.companiesUpdated.toLocaleString()}`);
  console.log(`Skipped (no key):    ${totals.skipped.toLocaleString()}`);
  console.log(`Errors:              ${totals.errors.toLocaleString()}`);
  console.log(`Total time:          ${totalElapsed}s`);

  // Per-workspace breakdown
  const byWorkspace = new Map<string, { people: number; companies: number; rows: number }>();
  for (const s of allStats) {
    const ws = s.workspace ?? "(no workspace)";
    const existing = byWorkspace.get(ws) ?? { people: 0, companies: 0, rows: 0 };
    existing.people += s.peopleCreated + s.peopleUpdated;
    existing.companies += s.companiesCreated + s.companiesUpdated;
    existing.rows += s.rowsProcessed;
    byWorkspace.set(ws, existing);
  }

  console.log("\nPer-workspace breakdown:");
  for (const [ws, data] of [...byWorkspace.entries()].sort()) {
    console.log(`  ${ws.padEnd(20)} ${data.rows.toLocaleString().padStart(8)} rows | ${data.people.toLocaleString().padStart(6)} people | ${data.companies.toLocaleString().padStart(6)} companies`);
  }

  // Per-file table
  console.log("\nPer-file breakdown:");
  console.log(`  ${"File".padEnd(50)} ${"Type".padEnd(16)} ${"Rows".padStart(8)} ${"P+".padStart(6)} ${"P~".padStart(6)} ${"C+".padStart(6)} ${"C~".padStart(6)} ${"Skip".padStart(6)} ${"Err".padStart(5)}`);
  console.log("  " + "-".repeat(110));
  for (const s of allStats) {
    const shortName = s.filename.length > 48 ? s.filename.slice(0, 45) + "..." : s.filename;
    console.log(
      `  ${shortName.padEnd(50)} ${String(s.type).padEnd(16)} ${s.rowsProcessed.toLocaleString().padStart(8)} ${s.peopleCreated.toLocaleString().padStart(6)} ${s.peopleUpdated.toLocaleString().padStart(6)} ${s.companiesCreated.toLocaleString().padStart(6)} ${s.companiesUpdated.toLocaleString().padStart(6)} ${s.skipped.toLocaleString().padStart(6)} ${s.errors.toLocaleString().padStart(5)}`
    );
  }

  if (dryRun) {
    console.log("\n=== DRY RUN — no data was written to the database ===");
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
