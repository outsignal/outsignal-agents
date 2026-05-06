---
vendor: EmailBison
slug: emailbison
source_urls:
  - https://docs.emailbison.com/get-started/introduction
  - https://docs.emailbison.com/get-started/authentication
  - https://docs.emailbison.com/get-started/pagination
  - https://docs.emailbison.com/campaigns/creating-campaigns
  - https://docs.emailbison.com/campaigns/overview
  - https://docs.emailbison.com/email-accounts/overview
  - https://docs.emailbison.com/email-accounts/adding-accounts
  - https://docs.emailbison.com/master-inbox/fetching-replies
  - https://docs.emailbison.com/master-inbox/responding-to-messages
  - https://docs.emailbison.com/master-inbox/attaching-leads-to-untracked-replies
  - https://docs.emailbison.com/tags/attaching-tags
  - docs/emailbison-dedi-api-reference.md
  - docs/api-specs/_vendor-source/emailbison/_README.md
  - docs/api-specs/_vendor-source/emailbison/openapi-2026-05-06.json
  - docs/api-specs/_vendor-source/emailbison/openapi-2026-05-06.yaml
  - docs/api-specs/_vendor-source/emailbison/postman-collection-2026-05-06.json
fetched: 2026-05-06T14:30:48Z
fetched_by: codex
fetch_method: WebFetch public docs + authenticated dashboard OpenAPI/Postman export
verification_status: verified
doc_confidence: official-full
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - webhooks
  - sdks
  - errors
  - breaking_changes
sections_missing: []
verification_notes: Authenticated EmailBison dashboard export from 2026-05-06 confirms the OpenAPI 3.0.3 server URL, endpoint surface, request/response schemas, webhook management endpoints, and webhook event enum. Vendor support confirmed EmailBison does not provide webhook signing; use URL-secret receiver validation as the pragmatic mitigation. Redacted production webhook payloads remain deferred to audit files.
last_user_fill: 2026-05-06
last_reviewed_against_adapter: 2026-05-06T14:30:48Z
our_implementation_files:
  - src/lib/emailbison/client.ts
  - src/lib/emailbison/types.ts
  - src/lib/emailbison/sync-senders.ts
  - src/lib/campaigns/deploy.ts
  - src/lib/campaigns/emailbison-reconcile.ts
empirical_audit_file: docs/audits/emailbison-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no names, no emails, no phone numbers, no LinkedIn URLs, no client-sensitive payloads
---

# EmailBison API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers: none for outbound API documentation.

EmailBison is our broadest send/inbox integration. The authenticated dashboard export confirms 132 OpenAPI paths, including sender management, sequences and variants, campaign schedules, reply handling, blacklist operations, workspace stats, custom variables, tags, webhook management, warmup controls, headless UI tokens, reply templates, and bulk lead/sender operations. This spec summarizes the operationally relevant surface and keeps the full source bundle in `docs/api-specs/_vendor-source/emailbison/`.

## Authentication

Canonical base URL:

- `https://app.outsignal.ai`

The authenticated OpenAPI export lists `https://app.outsignal.ai` as the server URL. The old `https://dedi.emailbison.com/api` examples apply to non-tenant EmailBison customers and are not a mismatch for Outsignal. Our current adapter is correct to use `https://app.outsignal.ai/api`.

EmailBison authenticates requests with bearer API tokens:

```http
Authorization: Bearer <api_token>
Content-Type: application/json
Accept: application/json
```

The public docs describe two token types:

- `api-user`: scoped to the workspace where the token was created.
- `super-admin`: impersonates the creating user and follows that user's current workspace.

The docs recommend `api-user` tokens because workspace scoping is simpler and more predictable. Our integration should prefer per-workspace `api-user` tokens and treat `super-admin` tokens as an operational hazard unless there is a specific admin automation need.

## Rate Limits

The local client comments document a limit of 3,000 requests per minute, equivalent to 50 requests per second. The OpenAPI export documents endpoint contracts but does not publish a separate quota table; keep the local retry/backoff behavior and confirm account-specific quotas with EmailBison before any high-volume bulk migration.

Our adapter applies:

- retryable statuses: `429`, `500`, `502`, `503`, `504`
- max retries: 3
- backoff: exponential 1s, 2s, 4s
- `429` behavior: respects `Retry-After` when present, otherwise waits 60s
- page size assumption: 15 records per page, matching EmailBison pagination docs

## Endpoints

The raw OpenAPI export contains the complete endpoint inventory. High-value surfaces confirmed by the export include:

- webhook management: `GET/POST /api/webhook-url`, `PUT /api/webhook-url/{id}`, `DELETE /api/webhook-url/{webhook_url_id}`, sample/test/event-type helpers
- bulk leads: `POST /api/leads/multiple`, `POST /api/leads/create-or-update/multiple`, `PATCH /api/leads/bulk-update-status`, `DELETE /api/leads/bulk`, `POST /api/leads/bulk/csv`
- bulk senders: `POST /api/sender-emails/bulk`, `PATCH /api/sender-emails/signatures/bulk`, `PATCH /api/sender-emails/daily-limits/bulk`, `POST /api/sender-emails/bulk-check-missing-mx-records`
- campaign sequencing: legacy and `v1.1` sequence-step paths, variant activate/deactivate endpoint, and campaign schedule templates
- inbox operations: reply state updates, forward/reply endpoints, reply templates, and campaign follow-up attachment
- workspace operations: master inbox settings, workspace stats, workspace chart stats, user/token management, and headless UI token generation

Existing operational wire constraint: `sequence_steps[].wait_in_days` minimum is `1`. The export examples also use `1` or higher. Keep this constraint until the v1.1 sequence PUT endpoint is empirically retested.

### GET /campaigns

- Purpose: list campaigns in the token-scoped workspace.
- Auth scope required: workspace API token.
- Used by our code: yes.
- Request body schema: none.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| page | integer | no | 1 | positive integer | Paginated responses use `data`, `links`, and `meta`. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | yes | Campaign records. |
| links | object | no | Pagination links. |
| meta | object | no | Pagination state. |

- Synthesized example response:

```json
{
  "data": [
    {
      "id": 123,
      "name": "Example Campaign",
      "status": "paused",
      "open_tracking": true,
      "can_unsubscribe": true
    }
  ],
  "meta": {
    "current_page": 1,
    "last_page": 1,
    "per_page": 15,
    "total": 1
  }
}
```

### POST /campaigns

- Purpose: create a campaign.
- Auth scope required: workspace API token.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| name | string | yes | n/a | n/a | Public docs describe this as the only required field. |

- Synthesized example request:

```json
{
  "name": "Example Campaign"
}
```

- Known gotchas:
  - Campaign creation is only the first step; schedule, settings, sequence, senders, and leads are separate API operations.

### PATCH /campaigns/{id}/update

- Purpose: update campaign settings.
- Auth scope required: workspace API token.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| max_emails_per_day | integer or null | no | 1000 in docs | positive integer | Campaign daily send cap. |
| max_new_leads_per_day | integer or null | no | 1000 in docs | positive integer | Daily new-lead intake cap. |
| plain_text | boolean or null | no | false | true, false | Plain-text campaign mode. |
| open_tracking | boolean or null | no | false | true, false | Open tracking flag. |
| reputation_building | boolean or null | no | false | true, false | Spam-protection setting. |
| can_unsubscribe | boolean or null | no | false | true, false | Whether unsubscribe links are enabled. |
| unsubscribe_text | string or null | no | null | n/a | Text used for unsubscribe link. |

### POST /campaigns/{campaign_id}/schedule

- Purpose: create a campaign sending schedule.
- Auth scope required: workspace API token.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| monday | boolean | yes | n/a | true, false | Day enabled flag. |
| tuesday | boolean | yes | n/a | true, false | Day enabled flag. |
| wednesday | boolean | yes | n/a | true, false | Day enabled flag. |
| thursday | boolean | yes | n/a | true, false | Day enabled flag. |
| friday | boolean | yes | n/a | true, false | Day enabled flag. |
| saturday | boolean | yes | n/a | true, false | Day enabled flag. |
| sunday | boolean | yes | n/a | true, false | Day enabled flag. |
| start_time | string | yes | n/a | HH:MM | Campaign window start. |
| end_time | string | yes | n/a | HH:MM | Campaign window end. |
| timezone | string | yes | n/a | IANA timezone | Public docs provide a UI-formatted timezone list. |
| save_as_template | boolean | yes | n/a | true, false | Required in public docs and our type comments. |

- Known gotchas:
  - Our types note that v1.1 returns `422` when `save_as_template` is omitted, even if older docs treated it as optional.

### GET /campaigns/{campaign_id}/schedule

- Purpose: retrieve a campaign schedule.
- Used by our code: yes.

### POST /campaigns/{campaign_id}/create-schedule-from-template

- Purpose: apply a saved schedule template.
- Used by our code: no.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| schedule_id | integer | yes | n/a | existing schedule template ID | High-value adjacent endpoint for reusable campaign setup. |

### GET /campaigns/schedule/templates

- Purpose: list reusable schedule templates.
- Used by our code: no.

### GET /campaigns/{campaign_id}/sequence-steps

- Purpose: retrieve campaign sequence steps.
- Used by our code: yes.

### POST /campaigns/v1.1/{campaign_id}/sequence-steps

- Purpose: create sequence steps.
- Auth scope required: workspace API token.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| title | string | yes | n/a | n/a | Sequence title. |
| sequence_steps | array | yes | n/a | n/a | Array of sequence-step objects. |
| sequence_steps[].email_subject | string | yes | n/a | n/a | Supports workspace custom variables. |
| sequence_steps[].email_body | string | yes | n/a | n/a | Supports workspace custom variables. |
| sequence_steps[].wait_in_days | integer | yes | n/a | minimum `1` | Days before next step. Keep `1+`; `0` is not a valid wire value. |
| sequence_steps[].order | integer | yes | n/a | positive integer | Step ordering. |
| sequence_steps[].thread_reply | boolean | yes | n/a | true, false | Whether step replies in thread. |
| sequence_steps[].variant | boolean or null | no | null | true, false | A/B variant flag. |
| sequence_steps[].variant_from_step | integer or null | conditional | null | step ID | Required when `variant` is true. |

- Known gotchas:
  - Our types note that v1.1 `PUT` sequence updates can 500 when each step lacks `variant`.
  - Sequence variants are an important capability gap for future A/B testing.

### PUT /campaigns/v1.1/sequence-steps/{sequence_id}

- Purpose: update existing sequence steps.
- Used by our code: yes.
- Known gotchas:
  - Include `variant` on each step until the exact server-side validation behavior is re-confirmed.

### PATCH /campaigns/{id}/pause

- Purpose: pause a campaign.
- Used by our code: yes.

### PATCH /campaigns/{id}/resume

- Purpose: resume or launch a campaign.
- Used by our code: yes.
- Known gotchas:
  - EmailBison scheduler runs when campaigns resume and at the end of a sending day. Pause/resume can manually force scheduler movement.

### DELETE /campaigns/{id}

- Purpose: delete a campaign.
- Used by our code: yes.

### POST /campaigns/{id}/duplicate

- Purpose: duplicate a campaign.
- Used by our code: yes.

### GET /campaigns/{id}/sender-emails

- Purpose: list sender emails attached to a campaign.
- Used by our code: yes.

### POST /campaigns/{id}/attach-sender-emails

- Purpose: attach sender emails to a campaign.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| sender_email_ids | integer[] | yes | n/a | existing sender IDs | Exact field name confirmed by local client. |

### POST /campaigns/{id}/add-sender-emails

- Purpose: alternate sender-email attachment endpoint.
- Used by our code: yes.
- Known gotchas:
  - Our client marks this as an undocumented alias. Phase 1 should verify whether it is officially supported or legacy-only.

### DELETE /campaigns/{id}/remove-sender-emails

- Purpose: remove sender emails from a campaign.
- Used by our code: yes.

### GET /sender-emails

- Purpose: list sender emails in the workspace.
- Used by our code: yes.
- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| data | array | yes | Sender-email records, including deliverability and connection state fields in local types. |

### PATCH /sender-emails/{id}

- Purpose: update sender-email settings.
- Used by our code: yes.

### POST /sender-emails/imap-smtp

- Purpose: bulk-upload custom SMTP sender accounts via CSV.
- Used by our code: no.
- Request content type: `multipart/form-data`.
- High-value capability:
  - Bulk sender management could reduce manual EmailBison setup work.

### POST /sender-emails/bulk

- Purpose: bulk sender-email upload endpoint shown in public docs examples.
- Used by our code: no.
- Verification note:
  - Public docs show `/api/sender-emails/imap-smtp` in text and `/api/sender-emails/bulk` in the example. Phase 1 should confirm canonical endpoint naming.

### GET /leads

- Purpose: list leads.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| page | integer | no | 1 | positive integer | Paginated at 15 records/page by default. |

### POST /leads

- Purpose: create a lead.
- Used by our code: yes.

### POST /leads/create-or-update/multiple

- Purpose: bulk create/update leads.
- Used by our code: yes.
- High-value capability:
  - Bulk operations should be preferred over per-lead writes when deploying larger campaigns.

### POST /campaigns/{campaign_id}/leads/attach-leads

- Purpose: attach existing leads to a campaign.
- Used by our code: yes.

### GET /campaigns/{campaign_id}/leads

- Purpose: list campaign leads.
- Used by our code: yes.

### GET /leads/{lead_id}/replies

- Purpose: fetch replies for a lead.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| search | string or null | no | null | n/a | Search term. |
| status | string or null | no | null | interested, automated_reply, not_automated_reply | Status filter. |
| folder | string or null | no | null | inbox, sent, spam, bounced, all | Folder filter. |
| read | boolean or null | no | null | true, false | Read-state filter. |
| campaign_id | integer or null | no | null | existing campaign ID | Campaign filter. |
| sender_email_id | integer or null | no | null | existing sender ID | Sender filter. |
| tag_ids | array or null | no | null | tag IDs | Tag filter. |

### GET /leads/{lead_id_or_email}/sent-emails

- Purpose: fetch campaign emails sent to a lead.
- Used by our code: no.

### PATCH /leads/{id}/unsubscribe

- Purpose: unsubscribe a lead.
- Used by our code: yes.
- Capability note:
  - EmailBison supports advanced unsubscribe flows through campaign settings and lead-level operations; our current usage is minimal.

### POST /leads/{id}/blacklist

- Purpose: blacklist a lead.
- Used by our code: yes.

### DELETE /leads/{id}

- Purpose: delete a lead.
- Used by our code: yes.

### GET /replies

- Purpose: list inbox replies.
- Used by our code: yes.

### GET /replies/{id}

- Purpose: retrieve a reply.
- Used by our code: yes.

### POST /replies/{reply_id}/reply

- Purpose: send a manual/API reply to an inbox message.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| message | string | yes | n/a | n/a | Reply content. |
| sender_email_id | integer | yes | n/a | sender email ID | Sender account to send from. |
| to_emails | array | yes | n/a | recipient objects | Recipient object has name and email address. |
| inject_previous_email_body | boolean or null | no | false | true, false | Include prior body. |
| content_type | string | no | implementation-specific | html, text | Public docs list html/text. |
| cc_emails | array | no | [] | recipient objects | Optional CC recipients. |
| bcc_emails | array | no | [] | recipient objects | Optional BCC recipients. |

### PATCH /replies/{id}/mark-as-read-or-unread

- Purpose: update read state.
- Used by our code: yes.

### PATCH /replies/{id}/mark-as-automated-or-not-automated

- Purpose: update automated-reply classification.
- Used by our code: yes.
- Capability note:
  - Reply automation/classification rules appear deeper in EmailBison's inbox surface; Phase 1 should inspect whether native rules can replace or augment our own classifier.

### PATCH /replies/{id}/mark-as-interested

- Purpose: mark a reply interested.
- Used by our code: yes.

### PATCH /replies/{id}/mark-as-not-interested

- Purpose: mark a reply not interested.
- Used by our code: yes.

### DELETE /replies/{id}

- Purpose: delete a reply.
- Used by our code: yes.

### GET /scheduled-emails/{lead_id_or_email}

- Purpose: list scheduled emails for a lead before attaching one to an untracked reply.
- Used by our code: yes.

### POST /replies/{reply_id}/attach-email-to-reply

- Purpose: attach a scheduled email to an untracked reply.
- Used by our code: yes.

### GET /tags

- Purpose: list tags.
- Used by our code: yes.

### POST /tags/attach-to-sender-emails

- Purpose: attach tags to sender emails.
- Used by our code: no.

### POST /tags/attach-to-leads

- Purpose: attach tags to leads.
- Used by our code: no.

### POST /tags/attach-to-campaigns

- Purpose: attach tags to campaigns.
- Used by our code: yes.
- Request body schema:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| tag_ids | integer[] | yes | n/a | existing tag IDs | Tags to attach. |
| campaign_ids | integer[] | yes | n/a | existing campaign IDs | Target campaigns. |

### GET /custom-variables

- Purpose: list workspace custom variables.
- Used by our code: yes.

### POST /custom-variables

- Purpose: create a workspace custom variable.
- Used by our code: yes.

### GET /blacklisted-domains

- Purpose: list blacklisted domains.
- Used by our code: yes.

### GET /blacklisted-domains/{domain}

- Purpose: check a domain blacklist entry.
- Used by our code: yes.

### POST /blacklisted-domains

- Purpose: create a domain blacklist entry.
- Used by our code: yes.

### GET /blacklisted-emails

- Purpose: list blacklisted emails.
- Used by our code: yes.

### GET /blacklisted-emails/{email}

- Purpose: check an email blacklist entry.
- Used by our code: yes.

### POST /blacklisted-emails

- Purpose: create an email blacklist entry.
- Used by our code: yes.

### GET /workspaces/v1.1/stats

- Purpose: fetch workspace-level stats.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| start_date | string | yes | n/a | YYYY-MM-DD | Start of reporting window. |
| end_date | string | yes | n/a | YYYY-MM-DD | End of reporting window. |

### GET /workspaces/{slug}/leads

- Purpose: lookup leads by workspace slug and email.
- Used by our code: yes.
- Query params:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| email | string | yes | n/a | email address | Used for cross-workspace lead lookup. |

### Webhook management endpoints

- Purpose: create/list/delete webhook subscriptions and send test events.
- Used by our code: limited.
- Phase note:
  - This Wave 2 spec covers outbound EmailBison API capabilities only.
  - Incoming EmailBison webhook receiver payload contracts are explicitly deferred to Wave 5.

## Webhooks

EmailBison supports webhook management through the API and dashboard. The authenticated export confirms webhook URL CRUD endpoints plus helpers for sample payloads, event-type discovery, and test events.

Vendor UI event enum captured on 2026-05-06:

- `email_sent`
- `manual_email_sent`
- `lead_first_contacted`
- `lead_replied`
- `lead_interested`
- `lead_unsubscribed`
- `email_opened`
- `email_bounced`
- `untracked_reply_received`
- `email_account_added`
- `email_account_removed`
- `email_account_disconnected`
- `email_account_reconnected`
- `tag_attached`
- `tag_removed`
- `warmup_disabled_causing_bounces`
- `warmup_disabled_receiving_bounces`

The inbound receiver contract lives in `docs/api-specs/webhook-emailbison-v1.md`. Redacted production payload samples should live in `docs/audits/emailbison-webhook-empirical-2026-05-06.md`, not inline in this spec.

## Webhook Security

Vendor support response on 2026-05-06 when asked whether EmailBison supports webhook signing secrets:

> **"no. and most webhook senders don't have them. If you're worried about security, you can always just scope your listeners to only accept webhooks from your bison url"**

Implications for our receiver:

- EmailBison does not provide HMAC signatures or signing secrets.
- The Phase 1 mitigation is a URL-secret query parameter on the webhook URL registered via `POST /api/webhook-url`, with the receiver failing closed when the secret is absent or wrong.
- IP allowlisting may be useful if EmailBison publishes stable egress ranges, but URL-secret validation is the immediate pragmatic fix.
- Current fail-open behavior remains a P0 security follow-up until the receiver validates the URL secret.

## SDKs / Official Clients

No official SDK was identified in the fetched docs. Public examples include cURL, JavaScript, and Python snippets. Our raw HTTP client remains appropriate until a maintained SDK is confirmed.

## Breaking Changes / Version History

The OpenAPI export is versioned as `1.0.0` and includes both legacy and `v1.1` campaign/sequence/workspace paths. Some legacy sequence endpoints are explicitly described as deprecated in the export while the `v1.1` sequence-step paths remain supported. EmailBison does not publish a separate changelog in the exported bundle; treat future dashboard exports as the source for drift detection.

## Our Current Implementation

Implementation files:

- `src/lib/emailbison/client.ts`
- `src/lib/emailbison/types.ts`
- `src/lib/emailbison/sync-senders.ts`
- `src/lib/campaigns/deploy.ts`
- `src/lib/campaigns/emailbison-reconcile.ts`

What we call:

- campaigns: list, get, create, update, pause/resume, duplicate, delete
- schedules: create/update/get
- sequences: get/create/update
- senders: list/update/attach/remove
- leads: list/create/bulk create-or-update/attach/unsubscribe/blacklist/delete
- replies: list/get/reply/mark states/delete/attach scheduled email
- tags/custom variables
- blacklisted domains/emails
- workspace stats

What we send:

- JSON request bodies for most endpoints
- bearer token headers
- multipart CSV only if sender bulk upload is later implemented

What we consume:

- paginated `data`/`meta`/`links` responses
- campaign, sender-email, reply, lead, tag, custom-variable, blacklist, and workspace-stat records

Local behavior:

- retries transient failures
- respects `Retry-After` on 429
- assumes 15-item pages
- validates loosely through TypeScript types rather than runtime schemas

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Token scope | Docs recommend workspace-scoped `api-user` tokens. | Client accepts one token env var; workspace-scope assumptions are implicit. | Audit token storage and workspace switching to prevent super-admin token bleed. |
| high | Webhook receiver auth | Vendor confirms no webhook signing support. | Receiver must use URL-secret validation because signatures are unavailable. | Add URL-secret query param validation and fail closed. |
| medium | Sequence variants | Docs expose `variant` and `variant_from_step`. | Adapter supports variants defensively but does not expose higher-level A/B testing strategy. | Decide whether campaign tooling should support variant authoring and reporting. |
| medium | Sequence v1.1 update | Export documents `PUT /api/campaigns/v1.1/sequence-steps/{sequence_id}`. | Prior empirical run saw 500s on this path. | Retest before relying on v1.1 sequence updates at scale. |
| medium | Schedule templates | Docs support schedule template reuse. | Adapter creates/updates schedules directly. | Consider templates to standardize client campaign windows. |
| medium | Sender bulk upload | Docs expose bulk custom SMTP upload. | Not implemented. | Evaluate for sender onboarding automation. |
| medium | Native reply classification | API/UI supports interested and automated reply flags. | We maintain our own inbox automation/classifier flows. | Audit whether EmailBison native classification rules can reduce duplicate logic. |
| medium | Unsubscribe flows | Campaign settings plus lead-level unsubscribe are available. | We use only selected operations. | Audit whether advanced unsubscribe/can_unsubscribe settings match compliance policy. |
| low | Webhook management | Docs expose webhook management and test events. | Receiver exists, management surface not broadly used. | Keep receiver contract for Wave 5; audit subscription drift separately. |
| low | Pagination | Docs say 15 data entries per page. | Client also assumes 15. | Confirm whether per-page limit can be changed safely. |

## Empirical Sanity Check

Do not commit production payloads inline in this spec. Use synthesized examples above.

- Audit file: `docs/audits/emailbison-empirical-2026-05-06.md`
- Webhook audit file: `docs/audits/emailbison-webhook-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

Synthesized webhook example shape:

```json
{
  "event": "lead_replied",
  "lead": {
    "id": 123,
    "email": "lead@example.com"
  },
  "campaign": {
    "id": 456
  },
  "workspace": {
    "id": 789
  }
}
```

The real empirical audit should replace this with redacted payload samples from EmailBison's test-event sender or production webhook logs.

## Known Limitations / Quirks

- Workspace scoping is central: API keys are always scoped to one workspace, and sender emails can only exist in one workspace at a time.
- EmailBison smart scheduling sends on a randomized pattern within the campaign schedule.
- The OpenAPI export is the canonical source bundle; public workflow docs supplement it with setup prose and operational examples.
- Both `POST /api/sender-emails/imap-smtp` and `POST /api/sender-emails/bulk` are documented. Treat them as separate single/bulk surfaces, not a naming mismatch.
- Webhooks are intentionally unsigned by the vendor. Our receiver must add URL-secret validation locally.
- `PUT /api/campaigns/v1.1/sequence-steps/{sequence_id}` is documented but needs empirical retest before we rely on it because Wave 2 saw 500 errors.
