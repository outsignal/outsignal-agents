---
vendor: Slack
slug: slack
source_urls:
  - https://docs.slack.dev/reference/methods/chat.postMessage/
  - https://docs.slack.dev/reference/methods/conversations.create/
  - https://docs.slack.dev/reference/methods/conversations.invite/
  - https://docs.slack.dev/reference/methods/conversations.inviteShared/
  - https://docs.slack.dev/reference/methods/users.lookupByEmail/
  - https://api.slack.com/web
fetched: 2026-05-06T15:09:09Z
fetched_by: codex
fetch_method: WebFetch direct + adapter audit
verification_status: verified
doc_confidence: official-full
sections_covered:
  - auth
  - endpoints
  - request_schemas
  - response_schemas
  - rate_limits
  - errors
  - sdks
  - breaking_changes
sections_missing:
  - webhooks
verification_notes: Official Slack Web API docs were fetchable for all methods used by `src/lib/slack.ts`. Slack event/webhook receivers are not implemented in this repo.
last_reviewed_against_adapter: 2026-05-06T15:09:09Z
our_implementation_files:
  - src/lib/slack.ts
  - src/lib/notifications.ts
  - src/lib/notification-guard.ts
  - src/lib/domain-health/notifications.ts
  - src/lib/domain-health/bounce-notifications.ts
  - src/lib/domain-health/reply-trend.ts
  - src/lib/postmaster/alerts.ts
  - src/lib/placement/notifications.ts
  - trigger.config.ts
empirical_audit_file: docs/audits/slack-empirical-2026-05-06.md
redaction_policy: no tokens, no channel ids from production, no user emails, no message bodies from incidents, no customer names
---

# Slack API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for current notification/channel usage

## Authentication

Slack Web API methods use an OAuth token, normally sent as bearer auth. The official Node SDK wraps this for us.

Current env vars:

- `SLACK_BOT_TOKEN`
- `OPS_SLACK_CHANNEL_ID`
- `ALERTS_SLACK_CHANNEL_ID`
- `REPLIES_SLACK_CHANNEL_ID`

Relevant scopes for current methods:

- `chat:write`
- `users:read.email`
- `groups:write` or invite scopes for private-channel invites
- `conversations.connect:write` for Slack Connect shared invites

## Rate Limits

Slack documents method tiers:

- `chat.postMessage`: special rate limit, generally around 1 message per second per channel with workspace-level limits.
- `conversations.create`: Tier 2, 20+ per minute.
- `conversations.invite`: Tier 3, 50+ per minute.
- `conversations.inviteShared`: Tier 2, 20+ per minute.
- `users.lookupByEmail`: Tier 3, 50+ per minute.

Rate-limited responses use Slack's Web API error style and may include `Retry-After`.

## Endpoints

### POST /api/chat.postMessage

- Purpose: send a Slack message.
- Used by our code: yes.
- Required scope: `chat:write`.
- Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| channel | string | yes | Channel or user ID. Code passes channel ID. |
| text | string | yes | Fallback/plain text. |
| blocks | array | no | Block Kit blocks. |

### POST /api/conversations.create

- Purpose: create a public/private channel.
- Used by our code: yes.
- Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| name | string | yes | Max 80 chars; lowercase letters, numbers, hyphens, underscores. |
| is_private | boolean | no | Code sets `true`. |
| team_id | string | no | Relevant for org tokens. |

Our adapter sanitizes names to lowercase and slices to 80 characters before calling Slack.

### POST /api/conversations.invite

- Purpose: invite workspace users by Slack user ID.
- Used by our code: yes.
- Request body:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| channel | string | yes | Channel ID. |
| users | string | yes | Comma-separated user IDs; Slack allows up to 1000. |
| force | boolean | no | Not used. |

### GET /api/conversations.inviteShared

- Purpose: invite external users to Slack Connect channel.
- Used by our code: yes.
- Required scope: `conversations.connect:write`.
- Request args:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| channel | string | yes | Channel ID. |
| emails | array | conditional | Either `emails` or `user_ids`; only one invite at a time. |
| user_ids | array | conditional | Not used. |
| external_limited | boolean | no | Defaults to true. |

Operational note: our code catches `not_paid` and `missing_scope` and treats Slack Connect as unavailable.

### GET /api/users.lookupByEmail

- Purpose: find workspace user ID by email.
- Used by our code: yes.
- Required scope: `users:read.email`.
- Request args:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| email | string | yes | User email. Redact in audits. |

Common error:

- `users_not_found`: our adapter returns null.

## Webhooks

No Slack event/webhook receiver is implemented in this repository.

## SDKs / Official Clients

The repository uses Slack's official Node SDK package `@slack/web-api`.

## Breaking Changes / Version History

No current breaking changes affect the methods used. Slack's Web API docs note that username-channel addressing is deprecated; our code uses IDs where appropriate.

## Our Current Implementation

Files:

- `src/lib/slack.ts`
- notification modules under `src/lib/**/notifications.ts`
- `trigger.config.ts` task failure notifications

Current behavior:

- Create private channels.
- Look up users by email.
- Invite workspace members by Slack user IDs.
- Send Slack Connect invites by external email.
- Post notification messages with optional blocks.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Slack Connect | `conversations.inviteShared` only invites one email/user at a time and may require paid plan/app relationship. | Adapter loops external emails and catches `not_paid`/`missing_scope`. | Good defensive handling; add metrics if channel setup matters operationally. |
| medium | Rate limits | Method tiers and `Retry-After` exist. | Adapter does not implement Slack-specific retry/backoff. | Add retry handling if notification bursts hit `ratelimited`. |
| low | Channel naming | Slack validates names. | Adapter sanitizes and truncates before create. | Keep; maybe test with edge channel names. |

## Empirical Sanity Check

- Audit file: `docs/audits/slack-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Slack user profile objects can include optional/null/empty fields; do not assume profile email unless scope is present.
- Slack Connect invite availability depends on plan and scopes.
- Incident notification text may contain client-sensitive details; redact before empirical audits.
