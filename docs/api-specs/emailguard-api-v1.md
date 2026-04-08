# EmailGuard API v1 Reference

Base URL: `https://app.emailguard.io/api/v1`
Auth: Bearer token (generate from dashboard)
Plan: Business ($129/mo) — upgraded 2026-04-08

## Key Endpoints

### Domains
- `GET /domains` — list all connected domains
- `POST /domains` — create/register domain
- `GET /domains/{uuid}` — domain details (DNS status, IP)
- `PATCH /domains/spf-record/{uuid}` — trigger SPF re-check
- `PATCH /domains/dkim-records/{uuid}` — trigger DKIM re-check (accepts `dkim_selectors` array)
- `PATCH /domains/dmarc-record/{uuid}` — trigger DMARC re-check
- `DELETE /domains/delete/{uuid}` — remove domain

### Email Accounts
- `GET /email-accounts` — list all connected accounts (name, email, connected, provider)
- `GET /email-accounts/{id}` — account details
- `POST /email-accounts/imap-smtp` — create IMAP/SMTP account (requires: name, provider, imap_*, smtp_*)
- `POST /email-accounts/test-imap-connection` — test IMAP
- `POST /email-accounts/test-smtp-connection` — test SMTP
- `DELETE /email-accounts/delete/{uuid}` — remove account

### Blacklist Checks
- `GET /blacklist-checks/domains` — list domain blacklist results (automated daily on Business)
- `GET /blacklist-checks/email-accounts` — list email account blacklist results
- `POST /blacklist-checks/ad-hoc` — manual blacklist check (unlimited on Business)
- `GET /blacklist-checks/{id}` — check details

### SURBL Blacklist
- `GET /surbl-blacklist-checks/domains` — list SURBL results
- `POST /surbl-blacklist-checks` — create SURBL check
- `GET /surbl-blacklist-checks/{uuid}` — check details

### DMARC Reports
- `GET /dmarc-reports` — list domains with DMARC monitoring (domain, spf, dkim, dmarc status)
- `GET /dmarc-reports/domains/{uuid}/insights` — DMARC stats (email_volume, pass counts, alignment)
- `GET /dmarc-reports/domains/{uuid}/dmarc-sources` — source IPs + alignment per source
- `GET /dmarc-reports/domains/{uuid}/dmarc-failures` — failure details

### Inbox Placement Tests
- `GET /inbox-placement-tests` — list all tests
- `POST /inbox-placement-tests` — create test (returns seed emails + filter_phrase)
- `GET /inbox-placement-tests/{id}` — test details (overall_score, per-email folder: inbox/spam/promotions)
- Flow: create → send email with filter_phrase to seed addresses → poll for results

### Spam Filter Tests (Rspamd)
- `GET /spam-filter-tests` — list tests
- `POST /spam-filter-tests` — create test (returns special email address)
- `GET /spam-filter-tests/{uuid}` — detailed Rspamd score breakdown with per-symbol analysis

### Content Spam Check
- `POST /content-spam-check` — check text for spam words (is_spam, spam_score, spam_words)

### Spamhaus Intelligence (300 credits/mo)
- Domain Reputation: `POST /spamhaus-intelligence/domain-reputation/create` (4 credits each!)
- A Record Reputation: `POST /spamhaus-intelligence/a-record-reputation/create`
- Domain Context: `POST /spamhaus-intelligence/domain-contexts/create`
- Domain Senders: `POST /spamhaus-intelligence/domain-senders/create`
- Nameserver Reputation: `POST /spamhaus-intelligence/nameserver-reputation/create`
- All async: create → poll show endpoint until status=completed

### Email Authentication Tools
- `GET /email-authentication/spf-lookup` — validate SPF
- `GET /email-authentication/dkim-lookup` — validate DKIM (requires domain + selector)
- `GET /email-authentication/dmarc-lookup` — validate DMARC
- Various generators for SPF/DKIM/DMARC records

### Hosted Domain Redirects
- CRUD for clean IP redirect domains (25 included in Business)

### Domain Masking Proxy
- CRUD for domain masking proxies

### Other
- `POST /domain-host-lookup` — find domain host (e.g., "Google")
- `POST /email-host-lookup` — find email host
- Workspaces API — multi-workspace support (switch workspace to access different data)
- Tags API — organize domains/accounts

## Webhooks (configured via UI, not API)
Events available:
- Domain Created, Domain Deleted
- SPF Record Updated, DKIM Record Updated, DMARC Record Updated, DMARC Service Updated
- Email Account Updated, Email Account Connected, Email Account Disconnected, Email Account Deleted
- Domain Blacklisted (!)
- Ad-Hoc Blacklist Check results
- Contact Verification Created/Finished
- Inbox Placement Test Created/Completed (with results)/Failed
- Spam Filter Test Created/Email Received
- Spamhaus Blacklist Check results (SURBL)
- Hosted Domain Redirect Created/Deleted
- Domain Masking Proxy Created/Deleted

## Key Notes
- Workspace-scoped: must switch workspace for multi-tenant access
- Email accounts require IMAP/SMTP credentials (pull from CheapInboxes API)
- Inbox placement tests require sending actual email to seed addresses
- Spamhaus reputation costs 4 credits/check (budget: ~75 checks/month)
- DMARC reports provide rich aggregate data (volume, sources, alignment rates)
