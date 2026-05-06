---
vendor: LinkedIn Voyager
slug: linkedin-voyager
source_urls:
  - worker/src/voyager-client.ts
  - worker/src/worker.ts
  - worker/src/session-server.ts
  - docs/briefs/2026-04-17-linkedin-worker-critical-bugs.md
  - docs/designs/linkedin-pull-model-v1.md
fetched: 2026-05-06T15:09:09Z
fetched_by: codex
fetch_method: adapter audit + internal design notes
verification_status: incomplete
doc_confidence: empirical-only
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - errors
sections_missing:
  - official_docs
  - official_rate_limits
  - official_sdks
  - breaking_changes
verification_notes: LinkedIn Voyager is an unofficial internal web API. There are no official docs for this integration. This note documents our observed usage patterns, fragility, and redaction rules so Phase 1 work starts from internal evidence rather than guesswork.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - worker/src/voyager-client.ts
  - worker/src/worker.ts
  - worker/src/session-server.ts
  - worker/src/keepalive.ts
  - src/app/api/linkedin
empirical_audit_file: docs/audits/linkedin-voyager-empirical-2026-05-06.md
redaction_policy: no li_at cookies, no JSESSIONID, no CSRF tokens, no profile URLs, no member URNs, no message bodies, no proxy credentials, no raw LinkedIn response bodies with PII
---

# LinkedIn Voyager Notes

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `empirical-only`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - No official API documentation exists for this usage.
  - Endpoint shapes can drift without notice.
  - Production samples must be heavily redacted and stored only in audits.

## Authentication

Voyager uses LinkedIn web-session cookies:

- `li_at`
- `JSESSIONID`

The client derives:

- CSRF token = unquoted `JSESSIONID`
- Cookie header sends `JSESSIONID="<value>"`

Request headers emulate LinkedIn web app traffic:

- browser `User-Agent`
- `Accept: application/vnd.linkedin.normalized+json+2.1`
- `csrf-token`
- `x-restli-protocol-version: 2.0.0`
- `x-li-lang: en_US`
- `x-li-track`
- contextual `Referer`

Proxy support:

- HTTP/HTTPS through `undici.ProxyAgent`
- SOCKS5 through `fetch-socks`

## Rate Limits

No official limits. The worker uses small random delays and session health checks. Known status handling:

- `401` / `403`: expired or invalid session.
- `429`: rate limited.
- redirects to `/checkpoint/` or `/challenge/`: checkpoint/challenge state.

## Endpoints

Base URL:

```text
https://www.linkedin.com/voyager/api
```

### GET /me

- Purpose: test session and resolve self URN/profile.
- Used by our code: yes.
- Response fields consumed:

| Field | Type | Notes |
| --- | --- | --- |
| included[].dashEntityUrn | string | Used to derive self profile URN. |
| included[].miniProfile.publicIdentifier | string | Fallback for public profile URL. |

### Profile resolution / view profile

- Purpose: resolve target profile/member URNs before write operations.
- Used by our code: yes.
- Notes:
  - `viewProfile()` is intentionally called before sending messages to extract recipient member URN.
  - Relationship response entities can drift; previous incidents saw `unknown` status for all checks.

### POST /voyagerMessagingDashMessengerMessages?action=createMessage

- Purpose: send LinkedIn message.
- Used by our code: yes.
- Body fields observed in adapter:

| Field | Type | Notes |
| --- | --- | --- |
| dedupeByClientGeneratedToken | boolean | Adapter sets false. |
| hostRecipientUrns | array | Recipient member URNs. |
| mailboxUrn | string | Self mailbox URN. |
| message | object | Message content. |
| originToken | string | Generated token. |
| trackingId | string | Generated tracking ID. |

### GET /voyagerMessagingGraphQL/graphql

- Purpose: fetch conversations.
- Used by our code: yes.
- Request:
  - `queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48`
  - `variables=(mailboxUrn:...)`
  - `Accept: application/graphql`

### GET /voyagerMessagingDashMessengerConversations

- Purpose: fallback conversation fetch.
- Used by our code: yes.
- Query params:

| Field | Type | Notes |
| --- | --- | --- |
| count | number | Adapter default limit is 20. |

## Webhooks

No external LinkedIn webhook exists. Worker callbacks/internal pull-model contracts are Wave 5 scope.

## SDKs / Official Clients

No official SDK exists for Voyager. The repo owns this adapter and must assume it is fragile.

## Breaking Changes / Version History

No official versioning. Endpoint paths, URN prefixes, response decorations, and GraphQL query IDs can drift at any time.

## Our Current Implementation

Files:

- `worker/src/voyager-client.ts`
- `worker/src/worker.ts`
- `worker/src/session-server.ts`
- `worker/src/keepalive.ts`
- `src/app/api/linkedin/**`

Current behavior:

- Test session health.
- Resolve own profile/member URN.
- Resolve target profile and relationship status.
- Send messages through Voyager messaging.
- Fetch conversations through GraphQL, falling back to REST.
- Detect checkpoint/challenge redirects.
- Route all requests through per-sender proxies when configured.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Official contract | No official contract. | Adapter depends on internal web endpoints. | Treat every endpoint as empirical; add response-shape validation and raw redacted diagnostics. |
| high | Relationship status | Prior docs indicate shape drift caused `unknown` statuses. | Adapter parses decorated entities heuristically. | Preserve raw redacted relationship samples for each status. |
| high | Conversation GraphQL | Query ID can drift. | Adapter hardcodes query ID and has REST fallback. | Add monitoring for fallback rate and query failure. |
| medium | Session state | Checkpoint/challenge redirects require special handling. | Adapter detects by URL and returns status. | Surface checkpoint state clearly in admin. |

## Empirical Sanity Check

- Audit file: `docs/audits/linkedin-voyager-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `all fields are empirical`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Voyager is not a public API and can change without warning.
- Cookies, CSRF tokens, profile URLs, member URNs, and message bodies are highly sensitive.
- Proxy routing must use `dispatcher`, not `agent`, with undici.
- Checkpoint/challenge states are normal operational hazards, not generic network failures.
