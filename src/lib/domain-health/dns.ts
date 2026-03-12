/**
 * DNS validation library for domain health monitoring.
 * Pure functions using Node.js dns/promises — zero external dependencies.
 * All functions are resilient to DNS timeouts and NXDOMAIN responses.
 */

import * as dns from "dns/promises";
import { Resolver } from "dns/promises";

import type {
  SpfResult,
  DkimResult,
  DmarcResult,
  MxResult,
  MtaStsResult,
  TlsRptResult,
  BimiResult,
  DnsCheckResult,
} from "./types";
import { DKIM_SELECTORS } from "./types";

const DNS_TIMEOUT_MS = 5000;
const LOG_PREFIX = "[domain-health]";

/** Create a Resolver with a 5-second timeout using Node.js dns/promises */
function createResolver(): Resolver {
  const resolver = new Resolver({ timeout: DNS_TIMEOUT_MS });
  return resolver;
}

/**
 * Look up SPF record for a domain.
 * Finds TXT record starting with "v=spf1".
 */
export async function checkSpf(domain: string): Promise<SpfResult> {
  const resolver = createResolver();
  try {
    const records = await resolver.resolveTxt(domain);
    // TXT records are returned as arrays of strings (chunks) — join each record
    const txtValues = records.map((chunks) => chunks.join(""));
    const spfRecord = txtValues.find((txt) =>
      txt.toLowerCase().startsWith("v=spf1")
    );

    if (!spfRecord) {
      return { status: "missing", record: null };
    }

    // Basic sanity check: must contain at least one mechanism
    const hasValidMechanism =
      /\b(include|ip4|ip6|a|mx|ptr|exists|redirect|all)\b/i.test(spfRecord);
    if (!hasValidMechanism) {
      return { status: "fail", record: spfRecord };
    }

    return { status: "pass", record: spfRecord };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { status: "missing", record: null };
    }
    console.error(
      `${LOG_PREFIX} SPF lookup failed for ${domain}:`,
      (err as Error).message
    );
    return { status: "missing", record: null };
  }
}

/**
 * Look up DKIM records for a domain across all known selectors.
 * Checks DKIM_SELECTORS in parallel and collects passing selectors.
 */
export async function checkDkim(domain: string): Promise<DkimResult> {
  const resolver = createResolver();

  const checks = await Promise.allSettled(
    DKIM_SELECTORS.map(async (selector) => {
      const dkimHost = `${selector}._domainkey.${domain}`;
      try {
        const records = await resolver.resolveTxt(dkimHost);
        const txtValues = records.map((chunks) => chunks.join(""));
        // Valid DKIM record must contain v=DKIM1
        const hasDkim = txtValues.some((txt) =>
          txt.toLowerCase().includes("v=dkim1")
        );
        return hasDkim ? selector : null;
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (
          code === "ENOTFOUND" ||
          code === "ENODATA" ||
          code === "ESERVFAIL"
        ) {
          return null;
        }
        console.error(
          `${LOG_PREFIX} DKIM lookup failed for ${dkimHost}:`,
          (err as Error).message
        );
        return null;
      }
    })
  );

  const passedSelectors = checks
    .filter(
      (r): r is PromiseFulfilledResult<NonNullable<(typeof checks)[number] extends PromiseSettledResult<infer V> ? V : never>> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value as string);

  if (passedSelectors.length === 0) {
    return { status: "missing", passedSelectors: [] };
  }

  if (passedSelectors.length === DKIM_SELECTORS.length) {
    return { status: "pass", passedSelectors };
  }

  return { status: "partial", passedSelectors };
}

/**
 * Look up DMARC record for a domain.
 * Finds TXT record at _dmarc.{domain} and parses the p= policy.
 */
export async function checkDmarc(domain: string): Promise<DmarcResult> {
  const resolver = createResolver();
  const dmarcHost = `_dmarc.${domain}`;

  try {
    const records = await resolver.resolveTxt(dmarcHost);
    const txtValues = records.map((chunks) => chunks.join(""));
    const dmarcRecord = txtValues.find((txt) =>
      txt.toLowerCase().startsWith("v=dmarc1")
    );

    if (!dmarcRecord) {
      return { status: "missing", policy: null, record: null, aspf: null, adkim: null };
    }

    // Parse policy from p= directive
    const policyMatch = dmarcRecord.match(/\bp=(\w+)/i);
    if (!policyMatch) {
      return { status: "fail", policy: null, record: dmarcRecord, aspf: null, adkim: null };
    }

    const policyValue = policyMatch[1].toLowerCase();
    if (
      policyValue !== "none" &&
      policyValue !== "quarantine" &&
      policyValue !== "reject"
    ) {
      return { status: "fail", policy: null, record: dmarcRecord, aspf: null, adkim: null };
    }

    // Parse alignment directives
    const aspfMatch = dmarcRecord.match(/\baspf=([rs])/i);
    const adkimMatch = dmarcRecord.match(/\badkim=([rs])/i);
    const aspf = aspfMatch ? (aspfMatch[1].toLowerCase() as "r" | "s") : null;
    const adkim = adkimMatch ? (adkimMatch[1].toLowerCase() as "r" | "s") : null;

    return {
      status: "pass",
      policy: policyValue as "none" | "quarantine" | "reject",
      record: dmarcRecord,
      aspf,
      adkim,
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { status: "missing", policy: null, record: null, aspf: null, adkim: null };
    }
    console.error(
      `${LOG_PREFIX} DMARC lookup failed for ${domain}:`,
      (err as Error).message
    );
    return { status: "missing", policy: null, record: null, aspf: null, adkim: null };
  }
}

/**
 * Look up MX records for a domain.
 * Returns pass if at least one valid MX record exists.
 */
export async function checkMx(domain: string): Promise<MxResult> {
  const resolver = createResolver();
  try {
    const records = await resolver.resolveMx(domain);
    const hosts = records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);

    if (hosts.length === 0) {
      return { status: "missing", hosts: [] };
    }
    return { status: "pass", hosts };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { status: "missing", hosts: [] };
    }
    console.error(
      `${LOG_PREFIX} MX lookup failed for ${domain}:`,
      (err as Error).message
    );
    return { status: "missing", hosts: [] };
  }
}

/**
 * Look up MTA-STS record for a domain.
 * Finds TXT record at _mta-sts.{domain} starting with "v=STSv1".
 */
export async function checkMtaSts(domain: string): Promise<MtaStsResult> {
  const resolver = createResolver();
  const mtaStsHost = `_mta-sts.${domain}`;

  try {
    const records = await resolver.resolveTxt(mtaStsHost);
    const txtValues = records.map((chunks) => chunks.join(""));
    const stsRecord = txtValues.find((txt) =>
      txt.toLowerCase().startsWith("v=stsv1")
    );

    if (!stsRecord) {
      return { status: "missing", id: null };
    }

    // Parse id= directive
    const idMatch = stsRecord.match(/\bid=(\S+)/i);
    return { status: "pass", id: idMatch ? idMatch[1] : null };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { status: "missing", id: null };
    }
    console.error(
      `${LOG_PREFIX} MTA-STS lookup failed for ${domain}:`,
      (err as Error).message
    );
    return { status: "missing", id: null };
  }
}

/**
 * Look up TLS-RPT record for a domain.
 * Finds TXT record at _smtp._tls.{domain} starting with "v=TLSRPTv1".
 */
export async function checkTlsRpt(domain: string): Promise<TlsRptResult> {
  const resolver = createResolver();
  const tlsRptHost = `_smtp._tls.${domain}`;

  try {
    const records = await resolver.resolveTxt(tlsRptHost);
    const txtValues = records.map((chunks) => chunks.join(""));
    const rptRecord = txtValues.find((txt) =>
      txt.toLowerCase().startsWith("v=tlsrptv1")
    );

    if (!rptRecord) {
      return { status: "missing", rua: null };
    }

    // Parse rua= directive
    const ruaMatch = rptRecord.match(/\brua=(\S+)/i);
    return { status: "pass", rua: ruaMatch ? ruaMatch[1] : null };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { status: "missing", rua: null };
    }
    console.error(
      `${LOG_PREFIX} TLS-RPT lookup failed for ${domain}:`,
      (err as Error).message
    );
    return { status: "missing", rua: null };
  }
}

/**
 * Look up BIMI record for a domain.
 * Finds TXT record at default._bimi.{domain} starting with "v=BIMI1".
 */
export async function checkBimi(domain: string): Promise<BimiResult> {
  const resolver = createResolver();
  const bimiHost = `default._bimi.${domain}`;

  try {
    const records = await resolver.resolveTxt(bimiHost);
    const txtValues = records.map((chunks) => chunks.join(""));
    const bimiRecord = txtValues.find((txt) =>
      txt.toLowerCase().startsWith("v=bimi1")
    );

    if (!bimiRecord) {
      return { status: "missing", logoUrl: null, vmcUrl: null };
    }

    // Parse l= directive (logo URL)
    const logoMatch = bimiRecord.match(/\bl=(\S+)/i);
    // Parse a= directive (VMC certificate URL, optional)
    const vmcMatch = bimiRecord.match(/\ba=(\S+)/i);

    return {
      status: "pass",
      logoUrl: logoMatch ? logoMatch[1] : null,
      vmcUrl: vmcMatch ? vmcMatch[1] : null,
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA" || code === "ESERVFAIL") {
      return { status: "missing", logoUrl: null, vmcUrl: null };
    }
    console.error(
      `${LOG_PREFIX} BIMI lookup failed for ${domain}:`,
      (err as Error).message
    );
    return { status: "missing", logoUrl: null, vmcUrl: null };
  }
}

/**
 * Run all DNS checks (SPF, DKIM, DMARC, MX, MTA-STS, TLS-RPT, BIMI) in parallel.
 * Returns combined results. Never throws.
 */
export async function checkAllDns(domain: string): Promise<DnsCheckResult> {
  const [spf, dkim, dmarc, mx, mtaSts, tlsRpt, bimi] = await Promise.all([
    checkSpf(domain),
    checkDkim(domain),
    checkDmarc(domain),
    checkMx(domain),
    checkMtaSts(domain),
    checkTlsRpt(domain),
    checkBimi(domain),
  ]);
  return { spf, dkim, dmarc, mx, mtaSts, tlsRpt, bimi };
}

/**
 * Compute overall health string from DNS results and blacklist hits.
 *
 * Rules:
 * - "critical"  → critical-tier blacklist hits (Spamhaus DBL), or SPF fail, or DMARC fail
 * - "warning"   → warning-tier-only blacklist hits, DKIM partial, DMARC policy "none", SPF/DMARC missing
 * - "healthy"   → SPF pass, DKIM pass/partial with no blacklists, DMARC pass with quarantine/reject
 * - "unknown"   → any other combination (e.g. all missing with no data)
 */
export function computeOverallHealth(
  dns: DnsCheckResult,
  blacklistHits: string[],
  blacklistSeverity?: "none" | "warning" | "critical",
): "healthy" | "warning" | "critical" | "unknown" {
  const { spf, dkim, dmarc } = dns;

  // Critical: critical-tier blacklist hits or hard fails
  if (blacklistHits.length > 0 && blacklistSeverity === "critical") return "critical";
  if (spf.status === "fail") return "critical";
  if (dmarc.status === "fail") return "critical";

  // Warning: warning-tier blacklist hits, missing records, or weak DMARC policy
  if (blacklistHits.length > 0 && blacklistSeverity === "warning") return "warning";
  if (spf.status === "missing") return "warning";
  if (dmarc.status === "missing") return "warning";
  if (dmarc.policy === "none") return "warning";
  if (dkim.status === "partial") return "warning";
  if (dkim.status === "missing") return "warning";
  if (dns.mx.status === "missing") return "warning";

  // Healthy: SPF pass, DKIM pass, DMARC pass with strong policy, MX pass
  if (
    spf.status === "pass" &&
    dkim.status === "pass" &&
    dmarc.status === "pass" &&
    dns.mx.status === "pass" &&
    (dmarc.policy === "quarantine" || dmarc.policy === "reject")
  ) {
    return "healthy";
  }

  return "unknown";
}
