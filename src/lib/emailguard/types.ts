// =============================================================================
// EmailGuard API Types
// https://app.emailguard.io/api/v1
// =============================================================================

// -- API Response Wrappers ----------------------------------------------------

export interface EmailGuardListResponse<T> {
  data: T[];
}

export interface EmailGuardSingleResponse<T> {
  data: T;
}

// -- Domain Management --------------------------------------------------------

export interface Domain {
  uuid: string;
  /** Domain name — API returns this as `name`, not `domain` */
  name: string;
  ip: string | null;
  /** SPF validation result — populated after PATCH trigger + GET read-back */
  spf_valid?: boolean;
  /** DKIM validation result */
  dkim_valid?: boolean;
  /** DMARC validation result */
  dmarc_valid?: boolean;
  /** Raw SPF record string */
  spf_record?: string | null;
  /** Raw DMARC record string */
  dmarc_record?: string | null;
  /** DKIM records array */
  dkim_records?: Array<Record<string, unknown>>;
}

// -- Email Authentication (DNS Lookups) ---------------------------------------

export interface AuthLookupResult {
  success: boolean;
  results: {
    valid: boolean;
    errors: string[];
  };
}

export type SpfLookupResult = AuthLookupResult;
export type DkimLookupResult = AuthLookupResult;
export type DmarcLookupResult = AuthLookupResult;

// -- Domain DNS Check Results (trigger-style, from PATCH endpoints) -----------
// These are the responses from the domain-level SPF/DKIM/DMARC PATCH triggers.
// Shape may vary; typed loosely for now.

export type SpfResult = Record<string, unknown>;
export type DkimResult = Record<string, unknown>;
export type DmarcResult = Record<string, unknown>;

// -- Blacklist Monitoring -----------------------------------------------------

export interface BlacklistCheck {
  id: number;
  domain_or_ip: string;
  blacklists: Array<{
    name: string;
    listed: boolean;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

// -- SURBL Checks -------------------------------------------------------------

export interface SurblCheck {
  uuid: string;
  domain: string;
  [key: string]: unknown;
}

// -- Spamhaus Intelligence ----------------------------------------------------
// All Spamhaus endpoints are async: POST creates a job, GET /{uuid} polls.
// Complex nested structures — typed loosely for initial integration.

export type SpamhausResponse = Record<string, unknown>;

// -- DMARC Reports ------------------------------------------------------------

export interface DmarcDomain {
  domain: string;
  last_report_processed: string | null;
  dmarc_being_monitored: boolean;
  spf: unknown;
  dkim: unknown;
  dmarc: unknown;
}

export interface DmarcInsight {
  email_volume: number;
  email_sources_count: number;
  dmarc_pass_count: number;
  [key: string]: unknown;
}

export interface DmarcSource {
  [key: string]: unknown;
}

export interface DmarcFailure {
  [key: string]: unknown;
}

// -- Content Spam Check -------------------------------------------------------

export interface SpamCheckMessage {
  is_spam: boolean;
  spam_score: number;
  number_of_spam_words: number;
  spam_words: string[];
  comma_separated_spam_words: string;
}

export interface SpamCheckResult {
  message: SpamCheckMessage;
}

// -- Inbox Placement Tests ----------------------------------------------------

export interface InboxTestEmail {
  [key: string]: unknown;
}

export interface InboxTest {
  uuid: string;
  name: string;
  filter_phrase: string;
  comma_separated_test_email_addresses: string;
  inbox_placement_test_emails: InboxTestEmail[];
  [key: string]: unknown;
}

// -- Spam Filter Tests --------------------------------------------------------

export interface SpamFilterScoreBreakdown {
  [key: string]: unknown;
}

export interface SpamFilterTest {
  uuid: string;
  name: string;
  spam_filter_email_address: string;
  score: number | null;
  score_breakdown: SpamFilterScoreBreakdown | null;
  [key: string]: unknown;
}

// -- Email Accounts -----------------------------------------------------------

export interface EmailAccount {
  id: number;
  name: string;
  email: string;
  connected: boolean;
  provider: string;
  [key: string]: unknown;
}

// -- Workspaces ---------------------------------------------------------------

export interface EmailGuardWorkspace {
  uuid: string;
  name: string;
  remaining_monthly_email_verification_credits: number;
  total_monthly_email_verification_credits: number;
  remaining_domains: number;
  total_domains: number;
  remaining_inbox_placement_tests: number;
  [key: string]: unknown;
}

// -- Host Lookups -------------------------------------------------------------

export interface DomainHostLookupResult {
  domain: string;
  domain_host: string;
}

export interface EmailHostLookupResult {
  email: string;
  email_host: string;
}

// -- Hosted Domain Redirects --------------------------------------------------

export interface HostedDomainRedirect {
  id: number;
  domain: string;
  redirect: string;
  [key: string]: unknown;
}

// -- Domain Masking Proxies ---------------------------------------------------

export interface DomainMaskingProxy {
  uuid: string;
  masking_domain: string;
  primary_domain: string;
  cluster_ip_address: string | null;
  status: string;
  [key: string]: unknown;
}

// -- Tags ---------------------------------------------------------------------

export interface Tag {
  uuid: string;
  name: string;
  color: string;
}

// -- Legacy aliases for backward compat ---------------------------------------
// These kept so callers importing old type names still compile.

export type DnsStatus = "valid" | "invalid" | "pending" | "unknown";
export type InboxTestStatus = "pending" | "processing" | "completed" | "failed";
export type InboxTestProviderResult = Record<string, unknown>;
export type SpamVerdict = "clean" | "suspicious" | "spam";
export type ContactVerificationStatus = "pending" | "processing" | "completed" | "failed";
export interface ContactList {
  id: number;
  name: string;
  status: ContactVerificationStatus;
  total: number;
  verified: number;
  invalid: number;
  created_at: string;
}
export interface ContactVerificationResult {
  id: number;
  email: string;
  status: string;
  reason: string | null;
}
/** @deprecated use DomainHostLookupResult or EmailHostLookupResult instead */
export interface HostLookupResult {
  domain?: string;
  email?: string;
  domain_host?: string;
  email_host?: string;
}

/** @deprecated API no longer uses simple login tokens */
export interface LoginResponse {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
}
