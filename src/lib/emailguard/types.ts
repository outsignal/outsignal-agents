// =============================================================================
// EmailGuard API Types
// https://app.emailguard.io/api/v1
// =============================================================================

// -- Authentication -----------------------------------------------------------

export interface LoginResponse {
  token: string;
  user: {
    id: number;
    name: string;
    email: string;
  };
}

// -- Domain Management --------------------------------------------------------

export type DnsStatus = "valid" | "invalid" | "pending" | "unknown";

export interface Domain {
  uuid: string;
  domain: string;
  spf_status: DnsStatus;
  dkim_status: DnsStatus;
  dmarc_status: DnsStatus;
  created_at: string;
  updated_at: string;
}

export interface SpfResult {
  valid: boolean;
  record: string | null;
  details: string[];
}

export interface DkimResult {
  valid: boolean;
  selector: string | null;
  record: string | null;
  details: string[];
}

export interface DmarcResult {
  valid: boolean;
  record: string | null;
  policy: string | null;
  details: string[];
}

// -- Blacklist Monitoring -----------------------------------------------------

export interface BlacklistCheck {
  id: number;
  domain: string;
  listed: boolean;
  lists: string[];
  checked_at: string;
}

// -- SURBL Checks -------------------------------------------------------------

export interface SurblCheck {
  uuid: string;
  domain: string;
  listed: boolean;
  checked_at: string;
}

// -- Spamhaus Intelligence ----------------------------------------------------
// Complex nested structures - typed loosely for initial integration

export type SpamhausResponse = Record<string, unknown>;

// -- DMARC Analytics ----------------------------------------------------------

export interface DmarcDomain {
  id: number;
  domain: string;
  created_at: string;
}

export interface DmarcInsight {
  domain: string;
  total_messages: number;
  pass_count: number;
  fail_count: number;
  pass_rate: number;
}

export interface DmarcSource {
  source_ip: string;
  hostname: string | null;
  message_count: number;
  spf_aligned: boolean;
  dkim_aligned: boolean;
}

export interface DmarcFailure {
  source_ip: string;
  hostname: string | null;
  disposition: string;
  spf_result: string;
  dkim_result: string;
  message_count: number;
}

// -- DNS Lookups --------------------------------------------------------------

export interface SpfLookupResult {
  valid: boolean;
  record: string | null;
  mechanisms: string[];
  lookups: number;
}

export interface DkimLookupResult {
  valid: boolean;
  selector: string;
  record: string | null;
}

export interface DmarcLookupResult {
  valid: boolean;
  record: string | null;
  policy: string | null;
  subdomain_policy: string | null;
  rua: string[];
  ruf: string[];
}

// -- Inbox Tests --------------------------------------------------------------

export type InboxTestStatus = "pending" | "processing" | "completed" | "failed";

export interface InboxTestProviderResult {
  provider: string;
  folder: string;
  score: number | null;
}

export interface InboxTest {
  id: number;
  status: InboxTestStatus;
  results: InboxTestProviderResult[];
  created_at: string;
  completed_at: string | null;
}

// -- Spam Filter Tests --------------------------------------------------------

export interface SpamFilterTest {
  id: number;
  status: InboxTestStatus;
  results: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

// -- Content Spam Check -------------------------------------------------------

export type SpamVerdict = "clean" | "suspicious" | "spam";

export interface SpamCheckResult {
  score: number;
  verdict: SpamVerdict;
  details: string[];
}

// -- Contact Verification -----------------------------------------------------

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

// -- Host Lookups -------------------------------------------------------------

export interface HostLookupResult {
  domain: string;
  mx_records: Array<{ priority: number; host: string }>;
  a_records: string[];
}

// -- API List Response --------------------------------------------------------

export interface EmailGuardListResponse<T> {
  data: T[];
}

export interface EmailGuardSingleResponse<T> {
  data: T;
}
