# EmailGuard Integration — Code Agent Brief

## Objective
Integrate EmailGuard API as the primary deliverability monitoring backend, replacing/enhancing our custom DNSBL, DMARC, and DNS checks. This consolidates multiple manual implementations into a single provider.

## EmailGuard API Overview
- **Base URL**: `https://app.emailguard.io`
- **Auth**: Bearer token (generate from dashboard, store as `EMAILGUARD_API_TOKEN` env var)
- **Free tier**: Rate limits TBD — start conservative (1 req/sec)

## Tasks

### 1. EmailGuard API Client
Create `src/lib/emailguard/client.ts`:

```ts
class EmailGuardClient {
  private token: string
  private baseUrl = 'https://app.emailguard.io/api/v1'

  // Auth
  async login(email: string, password: string): Promise<string> // POST /login — returns token

  // Domains
  async listDomains(): Promise<Domain[]> // GET /domains
  async createDomain(domain: string): Promise<Domain> // POST /domains
  async getDomain(uuid: string): Promise<Domain> // GET /domains/{uuid}
  async deleteDomain(uuid: string): Promise<void> // DELETE /domains/delete/{uuid}
  async checkSpf(uuid: string): Promise<SpfResult> // PATCH /domains/spf-record/{uuid}
  async checkDkim(uuid: string): Promise<DkimResult> // PATCH /domains/dkim-records/{uuid}
  async checkDmarc(uuid: string): Promise<DmarcResult> // PATCH /domains/dmarc-record/{uuid}

  // Blacklist Checks
  async listDomainBlacklists(): Promise<BlacklistCheck[]> // GET /blacklist-checks/domains
  async listEmailBlacklists(): Promise<BlacklistCheck[]> // GET /blacklist-checks/email-accounts
  async runAdHocBlacklist(domain: string): Promise<BlacklistCheck> // POST /blacklist-checks/ad-hoc
  async getBlacklistCheck(id: string): Promise<BlacklistCheck> // GET /blacklist-checks/{id}

  // SURBL Checks
  async listSurblChecks(): Promise<SurblCheck[]> // GET /surbl-blacklist-checks/domains
  async runSurblCheck(domain: string): Promise<SurblCheck> // POST /surbl-blacklist-checks
  async getSurblCheck(uuid: string): Promise<SurblCheck> // GET /surbl-blacklist-checks/{uuid}

  // Spamhaus Intelligence
  async listARecordReputation(): Promise<any[]> // GET /spamhaus-intelligence/a-record-reputation
  async checkARecordReputation(domain: string): Promise<any> // POST /spamhaus-intelligence/a-record-reputation/create
  async listDomainContexts(): Promise<any[]> // GET /spamhaus-intelligence/domain-contexts
  async checkDomainContext(domain: string): Promise<any> // POST /spamhaus-intelligence/domain-contexts/create
  async listDomainReputation(): Promise<any[]> // GET /spamhaus-intelligence/domain-reputation
  async checkDomainReputation(domain: string): Promise<any> // POST /spamhaus-intelligence/domain-reputation/create
  async listDomainSenders(): Promise<any[]> // GET /spamhaus-intelligence/domain-senders
  async checkDomainSenders(domain: string): Promise<any> // POST /spamhaus-intelligence/domain-senders/create
  async listNameserverReputation(): Promise<any[]> // GET /spamhaus-intelligence/nameserver-reputation
  async checkNameserverReputation(domain: string): Promise<any> // POST /spamhaus-intelligence/nameserver-reputation/create

  // DMARC Reports
  async listDmarcDomains(): Promise<any[]> // GET /dmarc-reports
  async getDmarcInsights(uuid: string): Promise<any> // GET /dmarc-reports/domains/{uuid}/insights
  async getDmarcSources(uuid: string): Promise<any> // GET /dmarc-reports/domains/{uuid}/dmarc-sources
  async getDmarcFailures(uuid: string): Promise<any> // GET /dmarc-reports/domains/{uuid}/dmarc-failures

  // Email Authentication
  async spfLookup(domain: string): Promise<any> // GET /email-authentication/spf-lookup
  async dkimLookup(domain: string, selector: string): Promise<any> // GET /email-authentication/dkim-lookup
  async dmarcLookup(domain: string): Promise<any> // GET /email-authentication/dmarc-lookup

  // Inbox Placement Tests
  async listInboxTests(): Promise<InboxTest[]> // GET /inbox-placement-tests
  async createInboxTest(params: any): Promise<InboxTest> // POST /inbox-placement-tests
  async getInboxTest(id: string): Promise<InboxTest> // GET /inbox-placement-tests/{id}

  // Spam Filter Tests
  async listSpamFilterTests(): Promise<any[]> // GET /spam-filter-tests
  async createSpamFilterTest(params: any): Promise<any> // POST /spam-filter-tests
  async getSpamFilterTest(uuid: string): Promise<any> // GET /spam-filter-tests/{uuid}

  // Content Spam Check
  async checkContentSpam(content: string): Promise<any> // POST /content-spam-check

  // Contact Verification
  async listContactLists(): Promise<any[]> // GET /contact-verification
  async createContactVerification(params: any): Promise<any> // POST /contact-verification
  async getContactList(uuid: string): Promise<any> // GET /contact-verification/show/{uuid}
  async downloadContactList(uuid: string): Promise<any> // GET /contact-verification/download/{uuid}

  // Domain/Email Host Lookup
  async domainHostLookup(domain: string): Promise<any> // POST /domain-host-lookup
  async emailHostLookup(email: string): Promise<any> // POST /email-host-lookup
}
```

### 2. Domain Sync
Create `src/lib/emailguard/sync.ts`:
- On first run, register all sending domains from our DB into EmailGuard via `POST /domains`
- Store EmailGuard `uuid` on our domain records (add `emailguardDomainUuid` field to schema if needed, or store in a mapping table/JSON)
- SPF/DKIM/DMARC checks get triggered per domain after registration

### 3. Replace Custom DNSBL Checks
Our current domain-health Trigger.dev task does manual DNS lookups against Spamhaus DBL, SURBL, URIBL. Replace with:
- `POST /blacklist-checks/ad-hoc` for on-demand checks
- `POST /surbl-blacklist-checks` for SURBL-specific checks
- `POST /spamhaus-intelligence/domain-reputation/create` for Spamhaus deep intelligence
- Keep the Trigger.dev task schedule (twice daily 8:00 + 20:00 UTC) but call EmailGuard instead of raw DNS

Update: `trigger/domain-health.ts` — swap DNS lookup logic for EmailGuard client calls.

### 4. Enhance Deliverability Page
Update the workspace deliverability page to show EmailGuard data:
- Spamhaus reputation score (not just listed/not listed)
- Domain context (where domain was observed in spam signals)
- Nameserver reputation
- DMARC report insights (sources, failures)

This is additive — show EmailGuard data alongside existing data where available.

### 5. Content Spam Check Integration
Wire `POST /content-spam-check` into the campaign copy review flow:
- Before a campaign goes live, optionally run content through EmailGuard spam check
- Show spam score/verdict on campaign detail page
- This replaces/complements our KB-based copy validation

### 6. Inbox Placement Tests
Wire `POST /inbox-placement-tests` into the deliverability page:
- "Run Inbox Test" button on workspace deliverability page
- Shows results (inbox/spam/missing) per provider (Gmail, Outlook, Yahoo, etc.)
- This replaces the mail-tester.com plan entirely

### 7. Contact Verification
Wire `POST /contact-verification` into the people/list import flow:
- After importing a list, optionally verify emails via EmailGuard
- Show verification results (valid/invalid/risky/unknown) per contact
- This complements our existing LeadMagic email validation

### 8. Env Var Setup
- `EMAILGUARD_API_TOKEN` — Bearer token from EmailGuard dashboard
- Add to `src/lib/env.ts` as optional var
- Set on Vercel via `printf` (no trailing newline)

### 9. Add to Integration Health
Update `/api/integrations/status` to include EmailGuard as a provider:
- Category: "Deliverability"
- Health check: `GET /api/v1/domains` (if 200, service is up)

## Priority Order
1. Client + env var (foundation)
2. Domain sync (register domains)
3. Replace DNSBL checks (immediate value — removes custom DNS hacks)
4. Blacklist + Spamhaus intelligence on deliverability page
5. Inbox placement tests
6. Content spam check
7. Contact verification (nice-to-have, we already have LeadMagic)

## Do NOT
- Remove existing deliverability code yet — run EmailGuard in parallel until verified
- Store EmailGuard credentials in code
- Call EmailGuard on every page load — cache results, refresh on schedule
- Exceed free tier limits — add rate limiting to the client

## Key Files to Modify
- `trigger/domain-health.ts` — swap DNS lookups for EmailGuard calls
- `src/app/(admin)/workspace/[slug]/deliverability/` — show EmailGuard data
- `src/app/api/integrations/status/route.ts` — add EmailGuard health check

## Key Files to Create
- `src/lib/emailguard/client.ts` — API client
- `src/lib/emailguard/sync.ts` — domain registration sync
- `src/lib/emailguard/types.ts` — response types
