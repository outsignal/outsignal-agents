/**
 * EmailGuard Domain Sync
 *
 * Syncs all sending domains from the database to EmailGuard,
 * registering new domains and triggering initial DNS checks.
 */

import { PrismaClient } from "@prisma/client";
import { emailguard } from "@/lib/emailguard/client";

const prisma = new PrismaClient();

export interface SyncResult {
  registered: number;
  alreadyExists: number;
  failed: string[];
}

/**
 * Sync all unique sending domains to EmailGuard.
 *
 * 1. Fetches unique domains from DomainHealth records + Sender email addresses
 * 2. Compares against already-registered EmailGuard domains
 * 3. Registers new domains and triggers SPF/DKIM/DMARC checks
 * 4. Stores emailguardUuid on DomainHealth records
 */
export async function syncDomainsToEmailGuard(): Promise<SyncResult> {
  const result: SyncResult = {
    registered: 0,
    alreadyExists: 0,
    failed: [],
  };

  // 1. Collect all unique sending domains from DB
  const allDomains = await collectAllDomains();
  if (allDomains.length === 0) {
    console.log("[emailguard-sync] No domains found to sync");
    return result;
  }
  console.log(`[emailguard-sync] Found ${allDomains.length} unique domains to sync`);

  // 2. Get already-registered domains from EmailGuard
  const existingDomains = await emailguard.listDomains();
  const existingByDomain = new Map(
    existingDomains.map((d) => [d.domain, d.uuid])
  );
  console.log(`[emailguard-sync] ${existingDomains.length} domains already registered in EmailGuard`);

  // 3. Register new domains + update existing UUIDs in DB
  for (const domain of allDomains) {
    const existingUuid = existingByDomain.get(domain);

    if (existingUuid) {
      // Domain already registered - just ensure UUID is stored locally
      result.alreadyExists++;
      await storeEmailGuardUuid(domain, existingUuid);
      continue;
    }

    // New domain - register it
    try {
      const created = await emailguard.createDomain(domain);
      console.log(`[emailguard-sync] Registered domain: ${domain} (uuid: ${created.uuid})`);

      // Store UUID in DomainHealth record
      await storeEmailGuardUuid(domain, created.uuid);

      // Trigger initial DNS checks (fire-and-forget, best effort)
      await triggerInitialChecks(created.uuid, domain);

      result.registered++;
    } catch (err) {
      const msg = `${domain}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[emailguard-sync] Failed to register domain: ${msg}`);
      result.failed.push(msg);
    }
  }

  console.log(
    `[emailguard-sync] Sync complete: ${result.registered} registered, ${result.alreadyExists} already existed, ${result.failed.length} failed`
  );

  return result;
}

/**
 * Collect all unique sending domains from DomainHealth records
 * and Sender email addresses.
 */
async function collectAllDomains(): Promise<string[]> {
  const domains = new Set<string>();

  // From DomainHealth records
  const healthRecords = await prisma.domainHealth.findMany({
    select: { domain: true },
  });
  for (const record of healthRecords) {
    domains.add(record.domain.toLowerCase());
  }

  // From Sender email addresses
  const senders = await prisma.sender.findMany({
    where: { emailAddress: { not: null } },
    select: { emailAddress: true },
  });
  for (const sender of senders) {
    if (sender.emailAddress) {
      const parts = sender.emailAddress.split("@");
      const domain = parts[1]?.toLowerCase();
      if (domain) domains.add(domain);
    }
  }

  return Array.from(domains);
}

/**
 * Store the EmailGuard UUID on the DomainHealth record,
 * creating the record if it doesn't exist.
 */
async function storeEmailGuardUuid(domain: string, uuid: string): Promise<void> {
  try {
    await prisma.domainHealth.upsert({
      where: { domain },
      create: {
        domain,
        emailguardUuid: uuid,
      },
      update: {
        emailguardUuid: uuid,
      },
    });
  } catch (err) {
    console.error(
      `[emailguard-sync] Failed to store UUID for ${domain}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Trigger initial SPF, DKIM, and DMARC checks for a newly registered domain.
 * Best-effort: failures are logged but don't block sync.
 */
async function triggerInitialChecks(uuid: string, domain: string): Promise<void> {
  const checks = [
    { name: "SPF", fn: () => emailguard.checkSpf(uuid) },
    { name: "DKIM", fn: () => emailguard.checkDkim(uuid) },
    { name: "DMARC", fn: () => emailguard.checkDmarc(uuid) },
  ];

  const results = await Promise.allSettled(checks.map((c) => c.fn()));

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      console.error(
        `[emailguard-sync] ${checks[i].name} check failed for ${domain}: ${(results[i] as PromiseRejectedResult).reason}`
      );
    }
  }
}
