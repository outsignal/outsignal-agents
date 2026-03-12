/**
 * Type definitions for DNS validation results and domain health data.
 * Used by the DNS validation library (dns.ts) and Prisma model (DomainHealth).
 */

/** DKIM selectors to check — covers Gmail (google) and Outlook (selector1, selector2) senders */
export const DKIM_SELECTORS = ["google", "default", "selector1", "selector2"] as const;

export type DkimSelector = typeof DKIM_SELECTORS[number];

/** Result of an SPF TXT record lookup */
export interface SpfResult {
  /** "pass" if valid SPF record found, "fail" if malformed, "missing" if absent */
  status: "pass" | "fail" | "missing";
  /** Raw SPF record text, or null if not found */
  record: string | null;
}

/** Result of DKIM TXT record lookups across all selectors */
export interface DkimResult {
  /** "pass" if all selectors found, "partial" if some found, "missing" if none found, "fail" if lookup errors */
  status: "pass" | "partial" | "fail" | "missing";
  /** Array of selector names that had valid DKIM records */
  passedSelectors: string[];
}

/** Result of a DMARC TXT record lookup */
export interface DmarcResult {
  /** "pass" if DMARC record found, "fail" if malformed, "missing" if absent */
  status: "pass" | "fail" | "missing";
  /** DMARC policy directive, or null if record not found */
  policy: "none" | "quarantine" | "reject" | null;
  /** Raw DMARC record text, or null if not found */
  record: string | null;
  /** SPF alignment mode from aspf= directive ("r" = relaxed, "s" = strict, null = not specified/defaults to relaxed) */
  aspf: "r" | "s" | null;
  /** DKIM alignment mode from adkim= directive ("r" = relaxed, "s" = strict, null = not specified/defaults to relaxed) */
  adkim: "r" | "s" | null;
}

/** Result of MX record lookup */
export interface MxResult {
  /** "pass" if valid MX records found, "missing" if no MX records */
  status: "pass" | "missing";
  /** Array of MX hostnames found */
  hosts: string[];
}

/** Result of MTA-STS TXT record lookup */
export interface MtaStsResult {
  /** "pass" if valid MTA-STS record found, "missing" if absent */
  status: "pass" | "missing";
  /** Policy ID from id= directive, or null if not found */
  id: string | null;
}

/** Result of TLS-RPT TXT record lookup */
export interface TlsRptResult {
  /** "pass" if valid TLS-RPT record found, "missing" if absent */
  status: "pass" | "missing";
  /** Reporting URI from rua= directive, or null if not found */
  rua: string | null;
}

/** Result of BIMI TXT record lookup */
export interface BimiResult {
  /** "pass" if valid BIMI record found, "missing" if absent */
  status: "pass" | "missing";
  /** Logo URL from l= directive, or null if not found */
  logoUrl: string | null;
  /** VMC certificate URL from a= directive, or null if not found */
  vmcUrl: string | null;
}

/** Combined DNS check results for all record types */
export interface DnsCheckResult {
  spf: SpfResult;
  dkim: DkimResult;
  dmarc: DmarcResult;
  mx: MxResult;
  mtaSts: MtaStsResult;
  tlsRpt: TlsRptResult;
  bimi: BimiResult;
}

/** Full domain health summary combining DNS and blacklist data */
export interface DomainHealthSummary {
  domain: string;
  /** Computed overall health: "healthy" | "warning" | "critical" | "unknown" */
  overallHealth: "healthy" | "warning" | "critical" | "unknown";
  dns: DnsCheckResult;
  /** Array of DNSBL names where the domain/IP is listed */
  blacklistHits: string[];
  /** When DNS was last checked, or null if never */
  lastChecked: Date | null;
}
