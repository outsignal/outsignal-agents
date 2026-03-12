/**
 * Automate Google Postmaster Tools domain verification via Dynadot DNS API.
 *
 * For each unique sending domain in the Sender table:
 *   1. Request a DNS TXT verification token from Google Site Verification API
 *   2. Add the TXT record via Dynadot API (preserving existing records)
 *   3. Wait briefly for DNS propagation
 *   4. Trigger verification via Google Site Verification API
 *
 * Usage: npx tsx scripts/verify-postmaster-domains.ts
 *
 * Required env vars:
 *   DATABASE_URL                    — Postgres connection string
 *   DYNADOT_API_KEY                 — Dynadot API key
 *   GOOGLE_POSTMASTER_CLIENT_ID     — Google OAuth client ID
 *   GOOGLE_POSTMASTER_CLIENT_SECRET — Google OAuth client secret
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { google } from "googleapis";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[verify-domains]";
const DYNADOT_DELAY_MS = 2_000; // Min delay between Dynadot API calls
const DNS_PROPAGATION_WAIT_MS = 5_000; // Wait after setting DNS before verifying
const VERIFICATION_METHOD = "DNS_TXT";
const SITE_TYPE = "INET_DOMAIN";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const prisma = new PrismaClient();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`${ts} ${LOG_PREFIX} ${msg}`);
}

function logError(msg: string, err?: unknown) {
  const ts = new Date().toISOString();
  console.error(`${ts} ${LOG_PREFIX} ERROR: ${msg}`, err ?? "");
}

/**
 * Extract unique domains from an array of email addresses.
 */
function extractUniqueDomains(emails: string[]): string[] {
  const domainSet = new Set<string>();
  for (const email of emails) {
    const atIndex = email.lastIndexOf("@");
    if (atIndex > 0) {
      domainSet.add(email.substring(atIndex + 1).toLowerCase());
    }
  }
  return Array.from(domainSet).sort();
}

// ---------------------------------------------------------------------------
// Google OAuth setup (mirrors src/lib/postmaster/client.ts)
// ---------------------------------------------------------------------------

async function getAuthenticatedOAuth2Client() {
  const clientId = process.env.GOOGLE_POSTMASTER_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_POSTMASTER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_POSTMASTER_CLIENT_ID or GOOGLE_POSTMASTER_CLIENT_SECRET"
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://admin.outsignal.ai/api/auth/google-postmaster/callback"
  );

  const auth = await prisma.postmasterAuth.findFirst();
  if (!auth?.refreshToken) {
    throw new Error(
      "No PostmasterAuth record found in DB. Run the OAuth flow first."
    );
  }

  oauth2Client.setCredentials({
    refresh_token: auth.refreshToken,
    access_token: auth.accessToken ?? undefined,
    expiry_date: auth.expiresAt?.getTime(),
  });

  // Persist refreshed access tokens
  oauth2Client.on("tokens", async (tokens) => {
    try {
      await prisma.postmasterAuth.update({
        where: { id: auth.id },
        data: {
          accessToken: tokens.access_token ?? null,
          expiresAt: tokens.expiry_date
            ? new Date(tokens.expiry_date)
            : null,
        },
      });
    } catch (err) {
      logError("Failed to persist refreshed access token", err);
    }
  });

  return oauth2Client;
}

// ---------------------------------------------------------------------------
// Dynadot API
// ---------------------------------------------------------------------------

async function setDynadotTxtRecord(
  domain: string,
  txtValue: string,
  apiKey: string
): Promise<void> {
  const url = new URL("https://api.dynadot.com/api3.json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("command", "set_dns2");
  url.searchParams.set("domain", domain);
  url.searchParams.set("main_record_type0", "txt");
  url.searchParams.set("main_record0", txtValue);
  url.searchParams.set("add_dns_to_current_setting", "yes");

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dynadot API HTTP ${res.status}: ${body}`);
  }

  const json = await res.json();

  // Dynadot returns { "SetDnsResponse": { "Status": "success" } } on success
  const status =
    json?.SetDnsResponse?.Status ??
    json?.SetDns2Response?.Status ??
    json?.status;
  if (
    status &&
    typeof status === "string" &&
    status.toLowerCase() !== "success"
  ) {
    throw new Error(`Dynadot API error: ${JSON.stringify(json)}`);
  }

  log(`  DNS TXT record added for ${domain}`);
}

// ---------------------------------------------------------------------------
// Google Site Verification
// ---------------------------------------------------------------------------

async function getVerificationToken(
  siteVerification: ReturnType<typeof google.siteVerification>,
  domain: string
): Promise<string> {
  const res = await siteVerification.webResource.getToken({
    requestBody: {
      site: {
        type: SITE_TYPE,
        identifier: domain,
      },
      verificationMethod: VERIFICATION_METHOD,
    },
  });

  const token = res.data.token;
  if (!token) {
    throw new Error(`No verification token returned for ${domain}`);
  }
  return token;
}

async function verifyDomain(
  siteVerification: ReturnType<typeof google.siteVerification>,
  domain: string
): Promise<void> {
  await siteVerification.webResource.insert({
    verificationMethod: VERIFICATION_METHOD,
    requestBody: {
      site: {
        type: SITE_TYPE,
        identifier: domain,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("Starting Google Postmaster domain verification");

  // --- Validate env vars ---
  const dynadotKey = process.env.DYNADOT_API_KEY;
  if (!dynadotKey) {
    throw new Error("Missing DYNADOT_API_KEY environment variable");
  }

  // --- Authenticate with Google ---
  log("Authenticating with Google OAuth...");
  const oauth2Client = await getAuthenticatedOAuth2Client();
  const siteVerification = google.siteVerification({
    version: "v1",
    auth: oauth2Client,
  });
  log("Google OAuth authenticated");

  // --- Fetch unique sending domains from DB ---
  log("Querying unique sending domains from Sender table...");
  const senders = await prisma.sender.findMany({
    where: { emailAddress: { not: null } },
    select: { emailAddress: true },
  });

  const emails = senders
    .map((s) => s.emailAddress)
    .filter((e): e is string => !!e);
  const domains = extractUniqueDomains(emails);
  log(`Found ${domains.length} unique domains from ${emails.length} senders`);

  if (domains.length === 0) {
    log("No domains to verify. Exiting.");
    return;
  }

  // --- Process each domain ---
  const succeeded: string[] = [];
  const failed: { domain: string; error: string }[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    log(`\n[${i + 1}/${domains.length}] Processing: ${domain}`);

    try {
      // Step 1: Get verification token from Google
      log(`  Requesting verification token...`);
      const token = await getVerificationToken(siteVerification, domain);
      log(`  Token: ${token.substring(0, 40)}...`);

      // Step 2: Add TXT record via Dynadot
      log(`  Adding TXT record via Dynadot...`);
      await setDynadotTxtRecord(domain, token, dynadotKey);

      // Rate-limit Dynadot calls
      await sleep(DYNADOT_DELAY_MS);

      // Step 3: Wait for DNS propagation
      log(
        `  Waiting ${DNS_PROPAGATION_WAIT_MS / 1000}s for DNS propagation...`
      );
      await sleep(DNS_PROPAGATION_WAIT_MS);

      // Step 4: Verify with Google
      log(`  Verifying domain with Google...`);
      await verifyDomain(siteVerification, domain);

      log(`  VERIFIED: ${domain}`);
      succeeded.push(domain);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);

      // Check if already verified (Google returns 409 or specific error)
      if (
        message.includes("already been verified") ||
        message.includes("409")
      ) {
        log(`  SKIPPED (already verified): ${domain}`);
        skipped.push(domain);
        continue;
      }

      logError(`  FAILED: ${domain} — ${message}`);
      failed.push({ domain, error: message });
    }
  }

  // --- Summary ---
  log("\n" + "=".repeat(60));
  log("VERIFICATION SUMMARY");
  log("=".repeat(60));
  log(`Total domains:    ${domains.length}`);
  log(`Succeeded:        ${succeeded.length}`);
  log(`Already verified: ${skipped.length}`);
  log(`Failed:           ${failed.length}`);

  if (succeeded.length > 0) {
    log(`\nSucceeded:`);
    succeeded.forEach((d) => log(`  + ${d}`));
  }

  if (skipped.length > 0) {
    log(`\nAlready verified:`);
    skipped.forEach((d) => log(`  ~ ${d}`));
  }

  if (failed.length > 0) {
    log(`\nFailed:`);
    failed.forEach(({ domain: d, error: e }) => log(`  x ${d}: ${e}`));
  }

  log("=".repeat(60));
}

main()
  .catch((err) => {
    logError("Fatal error", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
