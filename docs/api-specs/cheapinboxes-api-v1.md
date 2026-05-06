---
vendor: CheapInboxes
slug: cheapinboxes
source_urls:
  - https://www.cheapinboxes.com/
  - docs/api-specs/cheapinboxes-api-v1.md (pre-template internal reference, replaced in this wave)
fetched: 2026-05-06T14:30:48Z
fetched_by: codex
fetch_method: WebFetch public marketing site + existing repo reference
verification_status: incomplete
doc_confidence: internal-paste
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - webhooks
sections_missing:
  - errors
  - sdks
  - breaking_changes
verification_notes: Public marketing site is fetchable and confirms the vendor/product positioning, but no public API reference was found. Endpoint details are migrated from the existing pre-template internal spec and need dashboard or vendor-provided confirmation.
last_reviewed_against_adapter: 2026-05-06T14:30:48Z
our_implementation_files: []
empirical_audit_file: docs/audits/cheapinboxes-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# CheapInboxes API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `internal-paste`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - No public API reference was found.
  - Endpoint list comes from the existing internal pre-template spec.
  - Exact schemas, error payloads, SDK availability, and version history need user-provided fill.

The public website confirms CheapInboxes provides Google/Microsoft inboxes, automated DNS setup, OAuth connection, auto-reconnect, platform sync, workspace/domain management, and 24/7 support. API-specific details below remain internal-reference quality until confirmed from the CheapInboxes dashboard or vendor material.

## Authentication

Assumed base URL from the existing internal reference:

```text
https://api.cheapinboxes.com/v1
```

Assumed auth header:

```http
Authorization: Bearer <cheapinboxes_api_key>
Content-Type: application/json
Accept: application/json
```

Open verification items:

- canonical base URL
- token prefix and scopes
- token lifetime/rotation behavior
- account/workspace scoping model

## Rate Limits

The existing internal reference says `120 requests/minute`.

This is not verified from public docs. Phase 1 should confirm:

- per-token vs per-account scope
- burst behavior
- 429 payload shape
- retry-after header support

## Endpoints

### GET /mailboxes

- Purpose: list mailboxes.
- Used by our code: no current adapter.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | unknown | Mailbox records with email, status, domain, tags, provider, and daily limit per internal reference. |

### GET /mailboxes/{id}

- Purpose: get full mailbox details.
- Used by our code: no current adapter.

### GET /mailboxes/{id}/credentials

- Purpose: retrieve mailbox credentials needed for downstream platform registration.
- Used by our code: no current adapter.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| email | string | unknown | Mailbox email address. |
| password | string | unknown | Sensitive. Do not commit samples. |
| app_password | string | unknown | Sensitive. |
| imap_host | string | unknown | IMAP host. |
| imap_port | integer | unknown | IMAP port. |
| smtp_host | string | unknown | SMTP host. |
| smtp_port | integer | unknown | SMTP port. |

- Known gotchas:
  - This endpoint returns secrets. Any empirical audit must avoid committing payloads, even redacted fields should be reviewed carefully.

### GET /mailboxes/{id}/totp

- Purpose: retrieve TOTP codes for 2FA login.
- Used by our code: no current adapter.
- Security note:
  - Treat as highly sensitive. Avoid building automated usage until access controls are verified.

### POST /domains/{domainId}/mailboxes

- Purpose: create mailboxes on a domain.
- Used by our code: no current adapter.

### PATCH /mailboxes/{id}

- Purpose: update mailbox persona/tags.
- Used by our code: no current adapter.

### POST /mailboxes/bulk-tags

- Purpose: bulk tag management.
- Used by our code: no current adapter.

### POST /mailboxes/{id}/cancel

- Purpose: schedule mailbox cancellation.
- Used by our code: no current adapter.

### POST /mailboxes/{id}/cancel/undo

- Purpose: undo scheduled cancellation.
- Used by our code: no current adapter.

### GET /domains

- Purpose: list domains.
- Used by our code: no current adapter.
- Response fields from internal reference include status, provider, and forwarding state.

### GET /domains/{id}

- Purpose: get domain details.
- Used by our code: no current adapter.

### GET /domains/{id}/dns-records

- Purpose: retrieve DNS records, including MX, TXT/SPF/DKIM/DMARC, and CNAME.
- Used by our code: no current adapter.
- Capability note:
  - This is the likely bridge to EmailGuard registration and deliverability checks.

### POST /domains/{id}/dns-records

- Purpose: create DNS records.
- Used by our code: no current adapter.

### PATCH /domains/{id}/dns-records/{recordId}

- Purpose: update a DNS record.
- Used by our code: no current adapter.

### DELETE /domains/{id}/dns-records/{recordId}

- Purpose: delete a DNS record.
- Used by our code: no current adapter.

### GET /domains/{id}/dmarc

- Purpose: retrieve DMARC configuration.
- Used by our code: no current adapter.

### PATCH /domains/{id}/dmarc

- Purpose: update DMARC policy.
- Used by our code: no current adapter.

### PATCH /domains/{id}/forwarding

- Purpose: update domain forwarding URL.
- Used by our code: no current adapter.

### POST /domains/bulk-forwarding

- Purpose: bulk update forwarding.
- Used by our code: no current adapter.

### GET /domains/{id}/runs

- Purpose: retrieve domain provisioning history for debugging.
- Used by our code: no current adapter.

### GET /integrations

- Purpose: list sending-platform integrations.
- Used by our code: no current adapter.
- Internal reference lists Instantly, Smartlead, EmailBison, PlusVibe, and custom integrations.

### POST /integrations

- Purpose: create an integration.
- Used by our code: no current adapter.

### POST /integrations/{id}/sync

- Purpose: sync all mailboxes to a sending platform.
- Used by our code: no current adapter.

### POST /integrations/{id}/link-mailboxes

- Purpose: link specific mailboxes to an integration.
- Used by our code: no current adapter.

### POST /integrations/{id}/pull

- Purpose: pull state from a sending platform.
- Used by our code: no current adapter.

### POST /mailboxes/{id}/sync

- Purpose: sync one mailbox to its linked platform.
- Used by our code: no current adapter.

### POST /mailboxes/{id}/check-status

- Purpose: run real-time IMAP/SMTP connection check.
- Used by our code: no current adapter.

### POST /mailboxes/{id}/fix-connection

- Purpose: auto-repair broken mailbox connection.
- Used by our code: no current adapter.

### POST /discovery/domains/search

- Purpose: search available domains.
- Used by our code: no current adapter.

### GET /discovery/tlds

- Purpose: list available TLDs and prices.
- Used by our code: no current adapter.

### POST /orders/quote

- Purpose: generate pricing quote.
- Used by our code: no current adapter.

### POST /orders/checkout

- Purpose: place an order.
- Used by our code: no current adapter.

### GET /orders/{id}

- Purpose: retrieve order status.
- Used by our code: no current adapter.

### POST /domain-imports/bulk

- Purpose: stage domains for import.
- Used by our code: no current adapter.

### GET /domain-imports

- Purpose: list staged domain imports.
- Used by our code: no current adapter.

### GET /billing/summary

- Purpose: retrieve monthly spend and next invoice summary.
- Used by our code: no current adapter.

### GET /billing/usage

- Purpose: retrieve detailed usage breakdown.
- Used by our code: no current adapter.

### GET /billing/invoices

- Purpose: retrieve invoice history.
- Used by our code: no current adapter.

## Webhooks

The internal reference lists webhook subscription management endpoints and HMAC-SHA256 signed events:

- `POST /webhooks`
- `GET /webhooks`
- `DELETE /webhooks/{id}`
- `POST /webhooks/{id}/test`

Event names from the internal reference:

- `domain.provisioned`
- `domain.dns_configured`
- `mailbox.active`
- `mailbox.credentials_ready`
- `order.completed`
- `order.failed`
- `billing.invoice_paid`
- `billing.invoice_failed`

No receiver route for CheapInboxes currently exists in the repository.

## SDKs / Official Clients

No official SDK found. Needs user-provided fill.

## Breaking Changes / Version History

The existing internal reference says the API was released the week of 2026-04-07. No public version history or deprecation policy was found.

## Our Current Implementation

No current adapter was found in this repository.

Potential future integration path:

- use CheapInboxes credentials and DNS endpoints to automate EmailGuard registration
- use integration sync endpoints for EmailBison sender onboarding
- use status/fix endpoints to repair broken inbox connections
- use billing endpoints for cost reconciliation

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Documentation confidence | Endpoint list is internal-reference only. | No adapter exists. | Get dashboard/API reference before implementing anything that touches credentials or billing. |
| high | Secret payloads | Credentials and TOTP endpoints expose sensitive data. | No adapter exists. | Design redaction, audit logging, and access control before use. |
| medium | EmailBison sync | Internal reference says EmailBison is a native integration. | We currently manage EmailBison separately. | Audit whether CheapInboxes can reduce sender onboarding work. |
| medium | DNS automation | Internal reference exposes Cloudflare-backed DNS operations. | DNS repair is manual or handled elsewhere. | Compare with EmailGuard/Porkbun domain flows before choosing owner. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples only.

- Audit file: `docs/audits/cheapinboxes-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Public site is marketing/product documentation, not API reference.
- Credentials and TOTP endpoints need stricter security review than ordinary send APIs.
- CheapInboxes appears operationally important for mailbox procurement/sync, but it is not currently wired in code.
