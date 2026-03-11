/**
 * DNSBL (DNS-based Blackhole List) blacklist checker.
 * Checks domains and IPs against the top 13 DNSBLs used by Gmail/Outlook and major MTAs.
 *
 * Architecture:
 * - Domain-based DNSBLs (URI lists): query {domain}.{dnsbl}
 * - IP-based DNSBLs: query {reversed_ip}.{dnsbl}
 * - All 13 checks run in parallel via Promise.allSettled
 * - 3s timeout per query — graceful failure on DNS errors/timeouts
 */

import { Resolver } from "dns/promises";

const BLACKLIST_TIMEOUT_MS = 3000;
const LOG_PREFIX = "[domain-health/blacklist]";

export interface DnsblEntry {
  /** Hostname of the DNSBL to query */
  host: string;
  /** Display name */
  name: string;
  /** critical = Gmail/Outlook actually check these; warning = others that matter */
  tier: "critical" | "warning";
  /** DNSBL type: "domain" checks domain directly, "ip" checks sending IP, "both" checks both */
  type: "domain" | "ip" | "both";
  /** Link to self-service delisting */
  delistUrl?: string;
}

export interface BlacklistHit {
  list: string;
  tier: "critical" | "warning";
  delistUrl?: string;
}

export interface BlacklistResult {
  domain: string;
  hits: BlacklistHit[];
  checkedAt: Date;
}

/**
 * Top 13 DNSBLs split into critical and warning tiers.
 * Critical = Spamhaus + Barracuda (Gmail and Outlook actively check these).
 * Warning = others used by major MTAs and spam filters.
 */
// Defunct/low-value lists removed (2026-03): SORBS x3, WPBL, iX NiXSpam (shutdown),
// SpamEatingMonkey, JustSpam, TTK PTE, s5h.net, SpamRATS (low impact)
export const DNSBL_LIST: DnsblEntry[] = [
  // --- CRITICAL tier ---
  {
    host: "zen.spamhaus.org",
    name: "Spamhaus ZEN (SBL+XBL+PBL)",
    tier: "critical",
    type: "ip",
    delistUrl: "https://check.spamhaus.org/listed/",
  },
  {
    host: "b.barracudacentral.org",
    name: "Barracuda Reputation Block List",
    tier: "critical",
    type: "ip",
    delistUrl: "https://www.barracudacentral.org/lookups",
  },
  {
    host: "dbl.spamhaus.org",
    name: "Spamhaus DBL (Domain Block List)",
    tier: "critical",
    type: "domain",
    delistUrl: "https://check.spamhaus.org/listed/",
  },

  // --- WARNING tier ---
  {
    host: "bl.spamcop.net",
    name: "SpamCop Block List",
    tier: "warning",
    type: "ip",
    delistUrl: "https://www.spamcop.net/bl.shtml",
  },
  {
    host: "cbl.abuseat.org",
    name: "Composite Blocking List (CBL)",
    tier: "warning",
    type: "ip",
    delistUrl: "https://www.abuseat.org/lookup.cgi",
  },
  {
    host: "psbl.surriel.com",
    name: "Passive Spam Block List",
    tier: "warning",
    type: "ip",
    delistUrl: "https://psbl.org/remove",
  },
  {
    host: "ubl.unsubscore.com",
    name: "Unsubscribe Blacklist (UBL)",
    tier: "warning",
    type: "ip",
  },
  {
    host: "truncate.gbudb.net",
    name: "GBUdb Truncate",
    tier: "warning",
    type: "ip",
  },
  {
    host: "dnsbl-1.uceprotect.net",
    name: "UCEPROTECT Level 1",
    tier: "warning",
    type: "ip",
    delistUrl: "http://www.uceprotect.net/en/rblcheck.php",
  },
  {
    host: "bl.mailspike.net",
    name: "Mailspike Block List",
    tier: "warning",
    type: "ip",
  },
  {
    host: "multi.surbl.org",
    name: "SURBL Multi",
    tier: "warning",
    type: "domain",
    delistUrl: "https://surbl.org/surbl-analysis",
  },
  {
    host: "multi.uribl.com",
    name: "URIBL Multi",
    tier: "warning",
    type: "domain",
    delistUrl: "https://lookup.uribl.com/",
  },
  {
    host: "dnsbl.invaluement.com",
    name: "Invaluement ivmSIP",
    tier: "warning",
    type: "ip",
    delistUrl: "https://www.invaluement.com/lookup/",
  },
];

/**
 * Reverse the octets of an IPv4 address for DNSBL queries.
 * e.g. "1.2.3.4" → "4.3.2.1"
 */
export function reverseIp(ip: string): string {
  return ip.split(".").reverse().join(".");
}

/**
 * Check a single DNSBL entry for a given query (domain or reversed IP).
 * Returns the DNSBL entry if listed, null if clean or on error.
 */
async function checkSingleDnsbl(
  resolver: Resolver,
  query: string,
  entry: DnsblEntry,
): Promise<DnsblEntry | null> {
  const lookupHost = `${query}.${entry.host}`;
  try {
    // If it resolves (any A record returned), the address is listed
    await resolver.resolve4(lookupHost);
    return entry;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENOTFOUND = not listed (NXDOMAIN), ENODATA = no A records = not listed
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return null;
    }
    // Other errors (timeout, ESERVFAIL, etc.) — log and treat as unknown (not listed)
    if (code !== "ETIMEOUT" && code !== "ESERVFAIL") {
      console.warn(
        `${LOG_PREFIX} DNS error checking ${lookupHost}: ${(err as Error).message}`,
      );
    }
    return null;
  }
}

/**
 * Check a domain and optional sending IP against all DNSBLs in DNSBL_LIST.
 *
 * - Domain-type DNSBLs: query {domain}.{dnsbl}
 * - IP-type DNSBLs: query {reversed_ip}.{dnsbl} (uses EMAILBISON_SENDING_IP if ip param not provided)
 * - "both" type DNSBLs: check both domain and IP
 *
 * All 13 checks run in parallel. DNS errors are logged but don't fail the overall check.
 */
export async function checkBlacklists(
  domain: string,
  ip?: string,
): Promise<BlacklistResult> {
  const resolver = new Resolver({ timeout: BLACKLIST_TIMEOUT_MS });

  // Resolve sending IP — prefer param, then env var
  const sendingIp = ip ?? process.env.EMAILBISON_SENDING_IP;
  const reversedIp = sendingIp ? reverseIp(sendingIp) : null;

  const checks = DNSBL_LIST.map((entry) => {
    if (entry.type === "domain") {
      // Domain-based DNSBL: query domain directly
      return checkSingleDnsbl(resolver, domain, entry);
    } else if (entry.type === "ip") {
      // IP-based DNSBL: query reversed IP
      if (!reversedIp) {
        // No IP available — skip IP-only checks
        return Promise.resolve(null);
      }
      return checkSingleDnsbl(resolver, reversedIp, entry);
    } else {
      // "both": check domain and IP — listed if either is listed
      const domainCheck = checkSingleDnsbl(resolver, domain, entry);
      const ipCheck = reversedIp
        ? checkSingleDnsbl(resolver, reversedIp, entry)
        : Promise.resolve(null);
      return Promise.all([domainCheck, ipCheck]).then(
        ([d, i]) => d ?? i ?? null,
      );
    }
  });

  const results = await Promise.allSettled(checks);

  const hits: BlacklistHit[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const entry = DNSBL_LIST[i];

    if (result.status === "fulfilled" && result.value !== null) {
      hits.push({
        list: entry.name,
        tier: entry.tier,
        delistUrl: getDelistUrl(entry.host, domain, sendingIp ?? undefined) ?? entry.delistUrl,
      });
    } else if (result.status === "rejected") {
      console.error(
        `${LOG_PREFIX} Unexpected error checking ${entry.host} for ${domain}:`,
        result.reason,
      );
    }
  }

  if (hits.length > 0) {
    console.warn(
      `${LOG_PREFIX} Domain ${domain} listed on ${hits.length} DNSBL(s): ${hits.map((h) => h.list).join(", ")}`,
    );
  }

  return {
    domain,
    hits,
    checkedAt: new Date(),
  };
}

/**
 * Generate a pre-filled delist URL for a specific domain/IP on a given DNSBL.
 * Returns the generic delistUrl if no pre-filled format is available.
 */
export function getDelistUrl(dnsblHost: string, domain: string, ip?: string): string | undefined {
  switch (dnsblHost) {
    // Spamhaus — lookup page accepts IP or domain in URL
    case "zen.spamhaus.org":
      return ip ? `https://check.spamhaus.org/listed/?searchterm=${ip}` : undefined;
    case "dbl.spamhaus.org":
      return `https://check.spamhaus.org/listed/?searchterm=${domain}`;
    // Barracuda — lookup accepts IP
    case "b.barracudacentral.org":
      return ip ? `https://www.barracudacentral.org/lookups?ip_address=${ip}` : undefined;
    // SpamCop — lookup by IP
    case "bl.spamcop.net":
      return ip ? `https://www.spamcop.net/w3m?action=checkblock&ip=${ip}` : undefined;
    // CBL — lookup by IP
    case "cbl.abuseat.org":
      return ip ? `https://www.abuseat.org/lookup.cgi?ip=${ip}` : `https://www.abuseat.org/lookup.cgi`;
    // PSBL — removal by IP
    case "psbl.surriel.com":
      return ip ? `https://psbl.org/remove?ip=${ip}` : `https://psbl.org/remove`;
    // UCEPROTECT — check by IP
    case "dnsbl-1.uceprotect.net":
      return ip ? `http://www.uceprotect.net/en/rblcheck.php?ipr=${ip}` : `http://www.uceprotect.net/en/rblcheck.php`;
    // SURBL — lookup by domain
    case "multi.surbl.org":
      return `https://surbl.org/surbl-analysis?d=${domain}`;
    // URIBL — lookup by domain
    case "multi.uribl.com":
      return `https://lookup.uribl.com/?domain=${domain}`;
    // Invaluement — lookup by IP
    case "dnsbl.invaluement.com":
      return ip ? `https://www.invaluement.com/lookup/?ip=${ip}` : `https://www.invaluement.com/lookup/`;
    default:
      return undefined;
  }
}
