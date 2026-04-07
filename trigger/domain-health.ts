/**
 * Trigger.dev Scheduled Task: Domain Health Monitor
 *
 * Orchestrates DNS validation + blacklist checks + notifications + DomainHealth record upserts.
 * Scheduled twice daily at 8am + 8pm UTC.
 *
 * Key improvement over Vercel cron route: checks ALL domains (no 4-domain cap),
 * using Promise.allSettled for concurrent domain checking.
 *
 * Blacklist dedup: only fires alert on NEW listings vs previous state.
 * DNS escalation: first failure = warning, persistent >48h = critical.
 */

import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import {
  checkAllDns,
  checkDkim,
  checkMx,
  checkMtaSts,
  checkTlsRpt,
  checkBimi,
  computeOverallHealth,
} from "@/lib/domain-health/dns";
import type { DnsCheckResult } from "@/lib/domain-health/types";
// EmailGuard PATCH endpoints return opaque Record<string, unknown> results.
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
import { captureAllWorkspaces } from "@/lib/domain-health/snapshots";
import { syncDomainsToEmailGuard } from "@/lib/emailguard/sync";
import { emailguard } from "@/lib/emailguard/client";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

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
    where: {
      emailAddress: { not: null },
      workspace: { monitoringEnabled: true },
    },
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
  /** Previous blacklist severity from DB */
  previousBlacklistSeverity: "none" | "warning" | "critical";
  /** EmailGuard UUID for this domain (null if not synced) */
  emailguardUuid: string | null;
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
      blacklistSeverity: true,
      spfStatus: true,
      dkimStatus: true,
      dmarcStatus: true,
      overallHealth: true,
      updatedAt: true,
      emailguardUuid: true,
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
      previousBlacklistSeverity: (health?.blacklistSeverity as "none" | "warning" | "critical") ?? "none",
      emailguardUuid: health?.emailguardUuid ?? null,
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

  // 1. Run DNS checks — prefer EmailGuard for SPF/DKIM/DMARC, fall back to legacy
  let dnsResult: DnsCheckResult;

  if (process.env.EMAILGUARD_API_TOKEN && priority.emailguardUuid) {
    const uuid = priority.emailguardUuid;
    try {
      // EmailGuard for SPF/DKIM/DMARC (serialized by client throttle)
      const [egSpf, egDkim, egDmarc] = await Promise.allSettled([
        emailguard.checkSpf(uuid),
        emailguard.checkDkim(uuid),
        emailguard.checkDmarc(uuid),
      ]);

      const allFailed =
        egSpf.status === "rejected" &&
        egDkim.status === "rejected" &&
        egDmarc.status === "rejected";

      if (allFailed) {
        // All 3 EmailGuard calls failed — fall back to full legacy DNS checks
        console.warn(`${LOG_PREFIX} All EmailGuard DNS checks failed for ${domain}, falling back to legacy`);
        dnsResult = await checkAllDns(domain);
        dnsResult.source = "legacy";
      } else {
        // PATCH endpoints only trigger re-checks — they do NOT return validation results.
        // Read back the stored results via GET /domains/{uuid}.
        const domainData = await emailguard.getDomain(uuid);

        // Map EmailGuard stored results to our internal format.
        const spf: DnsCheckResult["spf"] = {
          status: domainData.spf_valid === true ? "pass" : domainData.spf_valid === false ? "fail" : "missing",
          record: domainData.spf_record ?? null,
        };

        let dkim: DnsCheckResult["dkim"];
        if (domainData.dkim_valid === true) {
          dkim = {
            status: "pass",
            passedSelectors: [],
          };
        } else if (domainData.dkim_valid === false) {
          // EmailGuard reported DKIM invalid — fallback to legacy DNS checker
          // which correctly follows CNAME chains (common with Microsoft 365)
          const legacyDkim = await checkDkim(domain);
          if (legacyDkim.status === "pass") {
            console.log(`${LOG_PREFIX} EmailGuard DKIM=invalid for ${domain}, but legacy DNS found valid DKIM via selectors: ${legacyDkim.passedSelectors.join(", ")}`);
            dkim = legacyDkim;
          } else {
            dkim = { status: "fail", passedSelectors: [] };
          }
        } else {
          dkim = { status: "missing", passedSelectors: [] };
        }

        const dmarcRecord = domainData.dmarc_record ?? null;
        const dmarc: DnsCheckResult["dmarc"] = {
          status: domainData.dmarc_valid === true ? "pass" : domainData.dmarc_valid === false ? "fail" : "missing",
          policy: dmarcRecord?.match(/\bp=(\w+)/i)?.[1]?.toLowerCase() as "none" | "quarantine" | "reject" | null ?? null,
          record: dmarcRecord,
          aspf: dmarcRecord?.match(/\baspf=([rs])/i)?.[1]?.toLowerCase() as "r" | "s" | null ?? null,
          adkim: dmarcRecord?.match(/\badkim=([rs])/i)?.[1]?.toLowerCase() as "r" | "s" | null ?? null,
        };

        // Log any individual EmailGuard PATCH trigger failures (non-fatal — results read from GET)
        if (egSpf.status === "rejected") {
          console.error(`${LOG_PREFIX} EmailGuard SPF trigger failed for ${domain}: ${egSpf.reason}`);
        }
        if (egDkim.status === "rejected") {
          console.error(`${LOG_PREFIX} EmailGuard DKIM trigger failed for ${domain}: ${egDkim.reason}`);
        }
        if (egDmarc.status === "rejected") {
          console.error(`${LOG_PREFIX} EmailGuard DMARC trigger failed for ${domain}: ${egDmarc.reason}`);
        }

        // MX, MTA-STS, TLS-RPT, BIMI still use Node.js DNS checks
        const [mx, mtaSts, tlsRpt, bimi] = await Promise.all([
          checkMx(domain),
          checkMtaSts(domain),
          checkTlsRpt(domain),
          checkBimi(domain),
        ]);

        dnsResult = { spf, dkim, dmarc, mx, mtaSts, tlsRpt, bimi, source: "emailguard" };
      }
    } catch (err) {
      // Unexpected error in EmailGuard DNS path — fall back to full legacy
      console.error(
        `${LOG_PREFIX} EmailGuard DNS check error for ${domain}, falling back to legacy: ${err instanceof Error ? err.message : String(err)}`
      );
      dnsResult = await checkAllDns(domain);
      dnsResult.source = "legacy";
    }
  } else {
    // No EmailGuard token or no UUID — use legacy DNS checks
    dnsResult = await checkAllDns(domain);
    dnsResult.source = "legacy";
  }

  // 2. Run blacklist check (conditional per targeting criteria)
  if (shouldCheckBlacklist(priority)) {
    if (process.env.EMAILGUARD_API_TOKEN) {
      // Use EmailGuard for blacklist + SURBL checks
      try {
        const [blResult, surblResult] = await Promise.allSettled([
          emailguard.runAdHocBlacklist(domain),
          emailguard.runSurblCheck(domain),
        ]);

        const egHits: string[] = [];

        if (blResult.status === "fulfilled" && blResult.value.blacklists) {
          // New API returns blacklists array with { name, listed } entries
          for (const bl of blResult.value.blacklists) {
            if (bl.listed) egHits.push(bl.name);
          }
        }
        if (surblResult.status === "fulfilled") {
          // SURBL check created — if it has immediate results, check them
          const surblVal = surblResult.value as Record<string, unknown>;
          if (surblVal.listed === true) {
            egHits.push("SURBL");
          }
        }

        // Log any individual failures but don't block
        if (blResult.status === "rejected") {
          console.error(`${LOG_PREFIX} EmailGuard blacklist check failed for ${domain}: ${blResult.reason}`);
        }
        if (surblResult.status === "rejected") {
          console.error(`${LOG_PREFIX} EmailGuard SURBL check failed for ${domain}: ${surblResult.reason}`);
        }

        // If at least one check succeeded, use EmailGuard results
        if (blResult.status === "fulfilled" || surblResult.status === "fulfilled") {
          blacklistHits = egHits;
          blacklistChecked = true;
        } else {
          // Both failed - fall back to legacy DNS checks
          console.warn(`${LOG_PREFIX} Both EmailGuard checks failed for ${domain}, falling back to DNS blacklist`);
          const legacyResult = await checkBlacklists(domain);
          blacklistHits = legacyResult.hits.map((h) => h.list);
          blacklistChecked = true;
        }

        // Also fetch domain reputation (informational, stored but doesn't affect health)
        try {
          const reputation = await emailguard.checkDomainReputation(domain);
          console.log(`${LOG_PREFIX} EmailGuard reputation for ${domain}: ${JSON.stringify(reputation)}`);
        } catch (repErr) {
          console.error(`${LOG_PREFIX} EmailGuard reputation check failed for ${domain}: ${repErr instanceof Error ? repErr.message : String(repErr)}`);
        }
      } catch (err) {
        // Unexpected error in EmailGuard path - fall back to legacy
        const msg = `EmailGuard check failed for ${domain}, falling back: ${err instanceof Error ? err.message : String(err)}`;
        console.error(`${LOG_PREFIX} ${msg}`);
        errors.push(msg);
        try {
          const legacyResult = await checkBlacklists(domain);
          blacklistHits = legacyResult.hits.map((h) => h.list);
          blacklistChecked = true;
        } catch (legacyErr) {
          const legacyMsg = `Legacy blacklist check also failed for ${domain}: ${legacyErr instanceof Error ? legacyErr.message : String(legacyErr)}`;
          console.error(`${LOG_PREFIX} ${legacyMsg}`);
          errors.push(legacyMsg);
          blacklistHits = priority.previousBlacklistHits;
        }
      }
    } else {
      // No EmailGuard token — use existing DNS blacklist checks
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
    }
  } else {
    // Not due for blacklist check — use previous hits for health computation
    blacklistHits = priority.previousBlacklistHits;
  }

  // 3. Determine blacklist severity (must happen before overall health computation)
  let blacklistSeverity: "none" | "warning" | "critical" = "none";
  if (blacklistHits.length > 0) {
    if (blacklistChecked) {
      // Fresh check — look up tiers from DNSBL_LIST
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
    } else {
      // Using previous hits — carry forward previous severity from DB
      blacklistSeverity = priority.previousBlacklistSeverity;
    }
  }

  // 4. Compute overall health (now tier-aware for blacklist hits)
  overallHealth = computeOverallHealth(dnsResult, blacklistHits, blacklistSeverity, dnsResult.source);

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
    mtaStsStatus: dnsResult.mtaSts.status,
    mtaStsId: dnsResult.mtaSts.id,
    tlsRptStatus: dnsResult.tlsRpt.status,
    tlsRptRua: dnsResult.tlsRpt.rua,
    bimiStatus: dnsResult.bimi.status,
    bimiLogoUrl: dnsResult.bimi.logoUrl,
    bimiVmcUrl: dnsResult.bimi.vmcUrl,
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

      // If domain is fully delisted (no remaining hits), create recovery events
      // for all inboxes on this domain that were escalated due to blacklist
      if (currentBlacklistHits.length === 0) {
        try {
          const affectedSenders = await prisma.sender.findMany({
            where: {
              emailAddress: { endsWith: `@${domain}` },
              emailBounceStatus: "critical",
            },
          });

          for (const sender of affectedSenders) {
            await prisma.$transaction([
              prisma.emailHealthEvent.create({
                data: {
                  senderEmail: sender.emailAddress!,
                  senderDomain: domain,
                  workspaceSlug: sender.workspaceSlug,
                  fromStatus: "critical",
                  toStatus: "healthy",
                  reason: "blacklist_cleared",
                  detail: `Domain ${domain} removed from blacklist: ${removedHits.join(", ")}`,
                  senderId: sender.id,
                },
              }),
              prisma.sender.update({
                where: { id: sender.id },
                data: {
                  emailBounceStatus: "healthy",
                  emailBounceStatusAt: new Date(),
                  consecutiveHealthyChecks: 0,
                },
              }),
            ]);
            console.log(
              `${LOG_PREFIX} ${sender.emailAddress}: blacklist cleared recovery — critical → healthy`,
            );
          }

          if (affectedSenders.length > 0) {
            console.log(
              `${LOG_PREFIX} Created ${affectedSenders.length} blacklist recovery event(s) for ${domain}`,
            );
          }
        } catch (err) {
          console.error(
            `${LOG_PREFIX} Failed to create blacklist recovery events for ${domain}:`,
            err,
          );
        }
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
// Scheduled task
// ---------------------------------------------------------------------------

export const domainHealthTask = schedules.task({
  id: "domain-health",
  cron: "0 8,20 * * *", // twice daily: 8am + 8pm UTC
  maxDuration: 300, // 5 min — enough for full domain fleet
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`${LOG_PREFIX} Starting domain health check at ${timestamp}`);

    // 0. Sync domains to EmailGuard (if token configured)
    if (process.env.EMAILGUARD_API_TOKEN) {
      try {
        const syncResult = await syncDomainsToEmailGuard();
        console.log(
          `${LOG_PREFIX} EmailGuard sync: ${syncResult.registered} registered, ${syncResult.alreadyExists} existing, ${syncResult.failed.length} failed`
        );
      } catch (err) {
        console.error(
          `${LOG_PREFIX} EmailGuard domain sync failed (continuing with health checks): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 1. Collect all unique sending domains
    const allDomains = await collectSendingDomains();

    if (allDomains.length === 0) {
      console.log(`${LOG_PREFIX} No sending domains found — nothing to check`);
      return {
        domainsChecked: 0,
        domainsTotal: 0,
        results: [],
        errors: [],
      };
    }

    // 2. Build priority queue — check ALL domains (no cap)
    const prioritized = await buildPriorityQueue(allDomains);
    const toCheck = prioritized; // all domains — no MAX_DOMAINS_PER_RUN cap

    console.log(
      `${LOG_PREFIX} Checking ${toCheck.length} of ${allDomains.length} domains: ${toCheck.map((d) => d.domain).join(", ")}`,
    );

    // 3. Check all domains concurrently with Promise.allSettled
    const domainResults = await Promise.allSettled(
      toCheck.map((priority) => checkDomain(priority))
    );

    const results: DomainCheckResult[] = [];
    const allErrors: string[] = [];
    const blacklistDigestItems: BlacklistDigestItem[] = [];
    const dnsFailureDigestItems: DnsFailureDigestItem[] = [];

    for (const settled of domainResults) {
      if (settled.status === "fulfilled") {
        const result = settled.value;
        results.push(result);
        allErrors.push(...result.errors);
        if (result.notificationData.blacklistHits) {
          blacklistDigestItems.push(result.notificationData.blacklistHits);
        }
        if (result.notificationData.dnsFailures) {
          dnsFailureDigestItems.push(result.notificationData.dnsFailures);
        }
      } else {
        allErrors.push(`Domain check failed: ${settled.reason}`);
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

    console.log(
      `${LOG_PREFIX} Step 1 complete: ${results.length} domains checked, ${allErrors.length} errors`,
    );

    if (allErrors.length > 0) {
      console.warn(`${LOG_PREFIX} Errors during domain health check:`, allErrors);
    }

    // -----------------------------------------------------------------------
    // Step 2: Bounce snapshots (merged from bounce-snapshots)
    // Captures daily bounce rate snapshots for all workspaces.
    // Only meaningful at 8am run but harmless to run at 8pm too (idempotent).
    // -----------------------------------------------------------------------
    console.log(`${LOG_PREFIX} Step 2: Bounce snapshot capture`);

    let bounceSnapshotResult: { workspaces: number; senders: number; errors: string[] } = {
      workspaces: 0,
      senders: 0,
      errors: [],
    };

    try {
      bounceSnapshotResult = await captureAllWorkspaces();
      console.log(
        `${LOG_PREFIX} Step 2 complete: ${bounceSnapshotResult.workspaces} workspaces, ${bounceSnapshotResult.senders} senders captured, ${bounceSnapshotResult.errors.length} errors`,
      );
      if (bounceSnapshotResult.errors.length > 0) {
        console.warn(`${LOG_PREFIX} Bounce snapshot errors:`, bounceSnapshotResult.errors);
      }
    } catch (err) {
      console.error(`${LOG_PREFIX} Bounce snapshot capture failed:`, err);
      bounceSnapshotResult.errors.push(err instanceof Error ? err.message : String(err));
    }

    return {
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
      bounceSnapshots: {
        workspaces: bounceSnapshotResult.workspaces,
        senders: bounceSnapshotResult.senders,
        errors: bounceSnapshotResult.errors.length,
      },
    };
  },
});
