# CheapInboxes API v1 Reference

Base URL: `https://api.cheapinboxes.com/v1` (assumed — confirm from dashboard)
Auth: `Authorization: Bearer ci_live_...`
Rate limit: 120 req/min
Released: Week of 2026-04-07

## Key Endpoints

### Mailboxes
- `GET /mailboxes` — list all mailboxes (email, status, domain, tags, provider, daily_limit)
- `GET /mailboxes/{id}` — full mailbox details
- `GET /mailboxes/{id}/credentials` — **IMAP/SMTP credentials** (email, password, app_password, imap_host/port, smtp_host/port)
- `GET /mailboxes/{id}/totp` — TOTP codes for 2FA login
- `POST /domains/{domainId}/mailboxes` — create new mailboxes on domain
- `PATCH /mailboxes/{id}` — update persona/tags
- `POST /mailboxes/bulk-tags` — bulk tag management
- `POST /mailboxes/{id}/cancel` — schedule cancellation
- `POST /mailboxes/{id}/cancel/undo` — reverse cancellation

### Domains
- `GET /domains` — list all domains (status, provider, forwarding)
- `GET /domains/{id}` — full domain details
- `GET /domains/{id}/dns-records` — **all DNS records from Cloudflare** (MX, TXT/SPF/DKIM/DMARC, CNAME)
- `POST /domains/{id}/dns-records` — **create DNS record** (add missing DKIM, custom TXT, etc.)
- `PATCH /domains/{id}/dns-records/{recordId}` — update DNS record
- `DELETE /domains/{id}/dns-records/{recordId}` — delete DNS record
- `GET /domains/{id}/dmarc` — get DMARC config (policy, rua, pct)
- `PATCH /domains/{id}/dmarc` — **update DMARC policy** (none/quarantine/reject)
- `PATCH /domains/{id}/forwarding` — update forwarding URL
- `POST /domains/bulk-forwarding` — bulk update forwarding
- `GET /domains/{id}/runs` — provisioning history (debug stuck domains)

### Integrations (Sending Platforms)
- `GET /integrations` — list all (Instantly, Smartlead, EmailBison, PlusVibe, custom)
- `POST /integrations` — create integration
- `POST /integrations/{id}/sync` — sync all mailboxes to platform
- `POST /integrations/{id}/link-mailboxes` — link specific mailboxes
- `POST /integrations/{id}/pull` — pull state from platform
- `POST /mailboxes/{id}/sync` — sync single mailbox
- `POST /mailboxes/{id}/check-status` — real-time IMAP/SMTP connection check
- `POST /mailboxes/{id}/fix-connection` — auto-repair broken connection

### Orders & Discovery
- `POST /discovery/domains/search` — search available domains
- `GET /discovery/tlds` — available TLDs + prices
- `POST /orders/quote` — pricing quote
- `POST /orders/checkout` — place order (new + imported domains)
- `GET /orders/{id}` — order status

### Domain Imports
- `POST /domain-imports/bulk` — stage domains for import
- `GET /domain-imports` — list staged imports
- Setup options: nameservers, Cloudflare connect, or DFY

### Billing
- `GET /billing/summary` — monthly spend, next invoice
- `GET /billing/usage` — detailed usage breakdown
- `GET /billing/invoices` — invoice history
- Payment methods CRUD

### Webhooks
- `POST /webhooks` — create subscription (HMAC-SHA256 signed)
- `GET /webhooks` — list subscriptions
- `DELETE /webhooks/{id}` — remove subscription
- `POST /webhooks/{id}/test` — send test event

Events: `domain.provisioned`, `domain.dns_configured`, `mailbox.active`, `mailbox.credentials_ready`, `order.completed`, `order.failed`, `billing.invoice_paid`, `billing.invoice_failed`

## Key Notes
- Credentials endpoint gives us everything needed for EmailGuard registration
- DNS management is via Cloudflare — can fix DKIM/DMARC programmatically
- EmailBison is a supported integration (native sync)
- Webhooks are HMAC-SHA256 signed (secret shown once on creation)
- Tags for organizing mailboxes into campaigns/client groups
