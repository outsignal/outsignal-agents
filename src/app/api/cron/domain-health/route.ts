/**
 * Daily cron endpoint: Domain Health Monitor
 *
 * Orchestrates DNS validation + blacklist checks + notifications + DomainHealth record upserts.
 * Scheduled daily at 8am UTC via cron-job.org (Authorization: Bearer <CRON_SECRET>).
 *
 * Progressive checking: processes up to 4 domains per run to stay within the 60s timeout.
 * Priority: domains with highest bounce rate first, then oldest lastDnsCheck.
 *
 * Blacklist dedup: only fires alert on NEW listings vs previous state.
 * DNS escalation: first failure = warning, persistent >48h = critical.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron-auth";
import { checkAllDns, computeOverallHealth } from "@/lib/domain-health/dns";
import { checkBlacklists } from "@/lib/domain-health/blacklist";
import {
  notifyBlacklistHit,
  notifyBlacklistDelisted,
  notifyDnsFailure,
  sendBlacklistDigestEmail,
  sendDnsFailureDigestEmail,
} from "@/lib/domain-health/notifications";
import type {
  BlacklistDigestItem,
  DnsFailureDigestItem,
} from "@/lib/domain-health/notifications";

export const maxDuration = 60;

// Process at most 4 domains per cron run
const MAX_DOMAINS_PER_RUN = 4;

// Blacklist checking threshold: only check domains with >3% bounce rate or not checked in 7+ days
const BOUNCE_RATE_THRESHOLD = 0.03;
const BLACKLIST_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// DNS failure escalation threshold: >48 hours = persistent/critical
const DNS_ESCALATION_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

const LOG_PREFIX = "[domain-health-cron]";

// ---------------------------------------------------------------------------
// Domain collection
// ---------------------------------------------------------------------------

/**
 * Collect all unique sending domains from active Sender email addresses.
 */
async function collectSendingDomains(): Promise<string[]> {
  const senders = await prisma.sender.findMany({
    where: { emailAddress: { not: null } },
    select: { emailAddress: true },
  });

  const domains = new Set<string>();
  for (const sender of senders) {
    if (sender.emailAddress) {
      const parts = sender.emailAddress.split("@");
      const domain = parts[1]?.toLowerCase();
      if (domain) domains.add(domain);
    }
  }

  return Array.from(domains);
}

// ---------------------------------------------------------------------------
// Domain prioritization
// ---------------------------------------------------------------------------

interface DomainPriority {
  domain: string;
  /** Highest recent bounce rate across all senders on this domain */
  maxBounceRate: number | null;
  /** When this domain was last DNS-checked (null = never) */
  lastDnsCheck: Date | null;
  /** When this domain was last blacklist-checked (null = never) */
  lastBlacklistCheck: Date | null;
  /** Previous blacklist hits (for dedup comparison) */
  previousBlacklistHits: string[];
  /** When DNS first started failing (for escalation logic) */
  firstFailingSince: Date | null;
  /** Current overall health status */
  overallHealth: string | null;
}

/**
 * Build priority queue for domains — highest bounce rate first, then oldest DNS check.
 */
async function buildPriorityQueue(domains: string[]): Promise<DomainPriority[]> {
  const now = new Date();

  // Load existing DomainHealth records for all domains
  const domainHealthRecords = await prisma.domainHealth.findMany({
    where: { domain: { in: domains } },
    select: {
      domain: true,
      lastDnsCheck: true,
      lastBlacklistCheck: true,
      blacklistHits: true,
      spfStatus: true,
      dkimStatus: true,
      dmarcStatus: true,
      overallHealth: true,
      updatedAt: true,
    },
  });

  const healthByDomain = new Map(domainHealthRecords.map((r) => [r.domain, r]));

  // Load recent bounce rates (last 3 days — most recent snapshot per domain)
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const recentSnapshots = await prisma.bounceSnapshot.findMany({
    where: {
      snapshotDate: { gte: threeDaysAgo },
      bounceRate: { not: null },
    },
    select: { senderDomain: true, bounceRate: true },
    orderBy: { bounceRate: "desc" },
  });

  // Max bounce rate per domain
  const maxBounceByDomain = new Map<string, number>();
  for (const snap of recentSnapshots) {
    if (snap.bounceRate !== null) {
      const current = maxBounceByDomain.get(snap.senderDomain) ?? 0;
      if (snap.bounceRate > current) {
        maxBounceByDomain.set(snap.senderDomain, snap.bounceRate);
      }
    }
  }

  const priorities: DomainPriority[] = domains.map((domain) => {
    const health = healthByDomain.get(domain);
    const maxBounceRate = maxBounceByDomain.get(domain) ?? null;

    // Parse previous blacklist hits
    let previousBlacklistHits: string[] = [];
    if (health?.blacklistHits) {
      try {
        previousBlacklistHits = JSON.parse(health.blacklistHits) as string[];
      } catch {
        previousBlacklistHits = [];
      }
    }

    // Determine if DNS is currently failing (to track escalation)
    let firstFailingSince: Date | null = null;
    if (health) {
      const isDnsFailing =
        health.spfStatus === "fail" ||
        health.spfStatus === "missing" ||
        health.dkimStatus === "fail" ||
        health.dkimStatus === "missing" ||
        health.dmarcStatus === "fail" ||
        health.dmarcStatus === "missing";

      if (isDnsFailing && health.updatedAt) {
        firstFailingSince = health.updatedAt;
      }
    }

    return {
      domain,
      maxBounceRate,
      lastDnsCheck: health?.lastDnsCheck ?? null,
      lastBlacklistCheck: health?.lastBlacklistCheck ?? null,
      previousBlacklistHits,
      firstFailingSince,
      overallHealth: health?.overallHealth ?? null,
    };
  });

  // Sort: critical/blacklisted first, then high bounce rate, then oldest check
  priorities.sort((a, b) => {
    // Critical/blacklisted domains first
    const aCritical = a.overallHealth === "critical" ? 1 : 0;
    const bCritical = b.overallHealth === "critical" ? 1 : 0;
    if (bCritical !== aCritical) return bCritical - aCritical;

    // High bounce rate domains next
    const aBounce = a.maxBounceRate ?? 0;
    const bBounce = b.maxBounceRate ?? 0;
    if (bBounce !== aBounce) return bBounce - aBounce;

    // Never checked before older checked
    if (!a.lastDnsCheck && b.lastDnsCheck) return -1;
    if (a.lastDnsCheck && !b.lastDnsCheck) return 1;
    if (!a.lastDnsCheck && !b.lastDnsCheck) return 0;

    // Oldest check first
    return (a.lastDnsCheck?.getTime() ?? 0) - (b.lastDnsCheck?.getTime() ?? 0);
  });

  return priorities;
}

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether blacklist check should run for this domain.
 * Always re-check previously blacklisted domains (to detect delisting ASAP).
 * Otherwise: domains with >3% bounce rate OR not checked in 7+ days (or never).
 */
function shouldCheckBlacklist(priority: DomainPriority): boolean {
  // Always re-check previously blacklisted domains
  if (priority.previousBlacklistHits.length > 0) return true;

  const hasBounceIssue =
    priority.maxBounceRate !== null && priority.maxBounceRate > BOUNCE_RATE_THRESHOLD;

  const neverChecked = !priority.lastBlacklistCheck;
  const overdueCheck =
    priority.lastBlacklistCheck &&
    Date.now() - priority.lastBlacklistCheck.getTime() > BLACKLIST_CHECK_INTERVAL_MS;

  return hasBounceIssue || neverChecked || overdueCheck === true;
}

/**
 * Determine whether a DNS failure is persistent (>48h).
 */
function isDnsPersistent(firstFailingSince: Date | null): boolean {
  if (!firstFailingSince) return false;
  return Date.now() - firstFailingSince.getTime() > DNS_ESCALATION_THRESHOLD_MS;
}

// ---------------------------------------------------------------------------
// Per-domain check
// ---------------------------------------------------------------------------

interface NotificationData {
  blacklistHits?: BlacklistDigestItem;
  dnsFailures?: DnsFailureDigestItem;
}

interface DomainCheckResult {
  domain: string;
  dnsChecked: boolean;
  blacklistChecked: boolean;
  overallHealth: string;
  blacklistHits: string[];
  errors: string[];
  notificationData: NotificationData;
}

async function checkDomain(
  priority: DomainPriority,
): Promise<DomainCheckResult> {
  const { domain } = priority;
  const errors: string[] = [];
  let overallHealth = "unknown";
  let blacklistHits: string[] = [];
  let blacklistChecked = false;

  // 1. Run DNS checks
  const dnsResult = await checkAllDns(domain);

  // 2. Run blacklist check (conditional per targeting criteria)
  if (shouldCheckBlacklist(priority)) {
    try {
      const blResult = await checkBlacklists(domain);
      blacklistHits = blResult.hits.map((h) => h.list);
      blacklistChecked = true;
    } catch (err) {
      const msg = `Blacklist check failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`${LOG_PREFIX} ${msg}`);
      errors.push(msg);
      // Use previous hits if blacklist check fails
      blacklistHits = priority.previousBlacklistHits;
    }
  } else {
    // Not due for blacklist check — use previous hits for health computation
    blacklistHits = priority.previousBlacklistHits;
  }

  // 3. Compute overall health
  overallHealth = computeOverallHealth(dnsResult, blacklistHits);

  // 4. Determine blacklist severity
  let blacklistSeverity: "none" | "warning" | "critical" = "none";
  if (blacklistChecked && blacklistHits.length > 0) {
    // Look up tiers from current check result
    try {
      const { DNSBL_LIST } = await import("@/lib/domain-health/blacklist");
      const hasCritical = blacklistHits.some((hitName) => {
        const entry = DNSBL_LIST.find((e) => e.name === hitName);
        return entry?.tier === "critical";
      });
      blacklistSeverity = hasCritical ? "critical" : "warning";
    } catch {
      blacklistSeverity = "warning";
    }
  }

  // 5. Upsert DomainHealth record
  const now = new Date();
  const updateData: Record<string, unknown> = {
    spfStatus: dnsResult.spf.status,
    spfRecord: dnsResult.spf.record,
    dkimStatus: dnsResult.dkim.status,
    dkimSelectors: JSON.stringify(dnsResult.dkim.passedSelectors),
    dmarcStatus: dnsResult.dmarc.status,
    dmarcPolicy: dnsResult.dmarc.policy,
    dmarcRecord: dnsResult.dmarc.record,
    dmarcAspf: dnsResult.dmarc.aspf,
    dmarcAdkim: dnsResult.dmarc.adkim,
    mxStatus: dnsResult.mx.status,
    mxHosts: JSON.stringify(dnsResult.mx.hosts),
    overallHealth,
    lastDnsCheck: now,
  };

  if (blacklistChecked) {
    updateData.blacklistHits = JSON.stringify(blacklistHits);
    updateData.blacklistSeverity = blacklistSeverity;
    updateData.lastBlacklistCheck = now;
  }

  try {
    await prisma.domainHealth.upsert({
      where: { domain },
      create: {
        domain,
        ...updateData,
      },
      update: updateData,
    });
  } catch (err) {
    const msg = `DomainHealth upsert failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`${LOG_PREFIX} ${msg}`);
    errors.push(msg);
  }

  // 6. Send notifications based on state changes (Slack only — emails batched later)
  const notificationData = await sendChangeNotifications(priority, dnsResult, blacklistHits, blacklistChecked);

  return {
    domain,
    dnsChecked: true,
    blacklistChecked,
    overallHealth,
    blacklistHits,
    errors,
    notificationData,
  };
}

// ---------------------------------------------------------------------------
// Notification diffing
// ---------------------------------------------------------------------------

async function sendChangeNotifications(
  priority: DomainPriority,
  dnsResult: Awaited<ReturnType<typeof checkAllDns>>,
  currentBlacklistHits: string[],
  blacklistChecked: boolean,
): Promise<NotificationData> {
  const { domain, previousBlacklistHits, firstFailingSince } = priority;
  const data: NotificationData = {};

  // --- Blacklist change detection ---
  if (blacklistChecked) {
    const newHits = currentBlacklistHits.filter(
      (hit) => !previousBlacklistHits.includes(hit),
    );
    const removedHits = previousBlacklistHits.filter(
      (hit) => !currentBlacklistHits.includes(hit),
    );

    if (newHits.length > 0) {
      // New listings — fetch full hit details for delist URLs
      try {
        const { DNSBL_LIST } = await import("@/lib/domain-health/blacklist");
        const hitsWithDetails = newHits.map((hitName) => {
          const entry = DNSBL_LIST.find((e) => e.name === hitName);
          return {
            list: hitName,
            tier: entry?.tier ?? "warning",
            delistUrl: entry?.delistUrl,
          };
        });
        // Send Slack immediately (skipEmail — emails are batched after the loop)
        await notifyBlacklistHit({ domain, hits: hitsWithDetails, skipEmail: true });
        // Collect for digest email
        data.blacklistHits = { domain, hits: hitsWithDetails };
      } catch (err) {
        console.error(`${LOG_PREFIX} Failed to send blacklist hit notification for ${domain}:`, err);
      }
    }

    if (removedHits.length > 0) {
      try {
        await notifyBlacklistDelisted({ domain, delistedFrom: removedHits });
      } catch (err) {
        console.error(`${LOG_PREFIX} Failed to send delist notification for ${domain}:`, err);
      }
    }
  }

  // --- DNS failure detection ---
  const failures: Array<{ check: "spf" | "dkim" | "dmarc" | "mx"; status: string }> = [];

  if (dnsResult.spf.status === "fail" || dnsResult.spf.status === "missing") {
    failures.push({ check: "spf", status: dnsResult.spf.status });
  }
  if (dnsResult.dkim.status === "fail" || dnsResult.dkim.status === "missing") {
    failures.push({ check: "dkim", status: dnsResult.dkim.status });
  }
  if (dnsResult.dmarc.status === "fail" || dnsResult.dmarc.status === "missing") {
    failures.push({ check: "dmarc", status: dnsResult.dmarc.status });
  }
  if (dnsResult.mx.status === "missing") {
    failures.push({ check: "mx", status: dnsResult.mx.status });
  }

  if (failures.length > 0) {
    const persistent = isDnsPersistent(firstFailingSince);
    try {
      // Send Slack immediately (skipEmail — emails are batched after the loop)
      await notifyDnsFailure({ domain, failures, persistent, skipEmail: true });
      // Collect for digest email
      data.dnsFailures = { domain, failures, persistent };
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send DNS failure notification for ${domain}:`, err);
    }
  }

  return data;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    console.log(
      `[${new Date().toISOString()}] Unauthorized: GET /api/cron/domain-health`,
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const timestamp = new Date().toISOString();
  console.log(`${LOG_PREFIX} Starting daily domain health check at ${timestamp}`);

  try {
    // 1. Collect all unique sending domains
    const allDomains = await collectSendingDomains();

    if (allDomains.length === 0) {
      console.log(`${LOG_PREFIX} No sending domains found — nothing to check`);
      return NextResponse.json({
        status: "ok",
        message: "No sending domains found",
        domainsChecked: 0,
        timestamp,
      });
    }

    // 2. Build priority queue and select top N
    const prioritized = await buildPriorityQueue(allDomains);
    const toCheck = prioritized.slice(0, MAX_DOMAINS_PER_RUN);

    console.log(
      `${LOG_PREFIX} Checking ${toCheck.length} of ${allDomains.length} domains: ${toCheck.map((d) => d.domain).join(", ")}`,
    );

    // 3. Check each domain sequentially (DNS + optional blacklist)
    const results: DomainCheckResult[] = [];
    const allErrors: string[] = [];
    const blacklistDigestItems: BlacklistDigestItem[] = [];
    const dnsFailureDigestItems: DnsFailureDigestItem[] = [];

    for (const priority of toCheck) {
      try {
        const result = await checkDomain(priority);
        results.push(result);
        allErrors.push(...result.errors);

        // Collect digest data for batched emails
        if (result.notificationData.blacklistHits) {
          blacklistDigestItems.push(result.notificationData.blacklistHits);
        }
        if (result.notificationData.dnsFailures) {
          dnsFailureDigestItems.push(result.notificationData.dnsFailures);
        }
      } catch (err) {
        const msg = `Unexpected error checking domain ${priority.domain}: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`${LOG_PREFIX} ${msg}`);
        allErrors.push(msg);
      }
    }

    // 4. Send batched digest emails (one email per type, covering all domains)
    try {
      await sendBlacklistDigestEmail(blacklistDigestItems);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send blacklist digest email:`, err);
    }
    try {
      await sendDnsFailureDigestEmail(dnsFailureDigestItems);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to send DNS failure digest email:`, err);
    }

    // 5. Build summary
    const summary = {
      status: allErrors.length === 0 ? "ok" : "partial",
      domainsChecked: results.length,
      domainsTotal: allDomains.length,
      results: results.map((r) => ({
        domain: r.domain,
        overallHealth: r.overallHealth,
        blacklistChecked: r.blacklistChecked,
        blacklistHits: r.blacklistHits.length,
        errors: r.errors.length,
      })),
      errors: allErrors,
      timestamp,
    };

    console.log(
      `${LOG_PREFIX} Complete: ${results.length} domains checked, ${allErrors.length} errors`,
    );

    if (allErrors.length > 0) {
      console.warn(`${LOG_PREFIX} Errors during domain health check:`, allErrors);
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Domain health check failed",
        timestamp,
      },
      { status: 500 },
    );
  }
}
