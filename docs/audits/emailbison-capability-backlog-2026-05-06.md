---
vendor: EmailBison
created: 2026-05-06T19:33:04Z
created_by: codex
source_materials:
  - docs/api-specs/_vendor-source/emailbison/_README.md
  - docs/api-specs/_vendor-source/emailbison/openapi-2026-05-06.json
  - docs/api-specs/_vendor-source/emailbison/openapi-2026-05-06.yaml
  - docs/api-specs/_vendor-source/emailbison/postman-collection-2026-05-06.json
related_spec: docs/api-specs/emailbison-api-v1.md
redaction_policy: no production payloads, no tokens, no secrets, no names, no emails, no phone numbers, no client-sensitive payloads
---

# EmailBison Capability Backlog - Underused Features

This backlog converts the 2026-05-06 authenticated EmailBison OpenAPI/Postman export into Phase 1 implementation candidates. It is intentionally docs-only: no adapter, receiver, migration, or runtime behavior changes ship from this file.

## P0 - Security And Operational Urgency

| # | Feature | Endpoint | Current usage | Proposed usage | Priority | Effort estimate |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | URL secret webhook auth | `POST /api/webhook-url` plus local webhook receiver validation | EmailBison receiver accepts unsigned requests; vendor confirmed no signing support. | Register webhook URLs with an unguessable secret query param and make the receiver fail closed when the secret is absent or wrong. | P0 Security | S, 0.5-1 day |
| 2 | Sender lifecycle and warmup-disabled events | `POST /api/webhook-url` subscribing to `warmup_disabled_causing_bounces`, `warmup_disabled_receiving_bounces`, `email_account_added`, `email_account_removed`, `email_account_disconnected`, `email_account_reconnected` | Account and warmup events are not routed into the deliverability monitor. | Subscribe and route events into the existing Monty deliverability monitor so sender health changes become operational alerts. | P0 Operational | M, 1-2 days |
| 3 | Tag event audit trail | `POST /api/webhook-url` subscribing to `tag_attached`, `tag_removed` | Tag changes are not first-class audit events in our local records. | Store tag attach/remove events for campaign/list auditability and later debugging of allocation changes. | P0 Operational | S, 0.5-1 day |

## P1 - High Leverage, Low Effort

| # | Feature | Endpoint | Current usage | Proposed usage | Priority | Effort estimate |
| ---: | --- | --- | --- | --- | --- | --- |
| 4 | Bulk lead operations | `POST /api/leads/multiple`, `POST /api/leads/create-or-update/multiple`, `PATCH /api/leads/bulk-update-status`, `DELETE /api/leads/bulk`, `POST /api/leads/bulk/csv` | Several flows still behave like per-record loops or depend on only one bulk surface. | Move staging, sync, status updates, and deletes to the documented bulk endpoints where semantics match. | P1 | M, 1-2 days |
| 5 | Bulk sender operations | `PATCH /api/sender-emails/signatures/bulk`, `PATCH /api/sender-emails/daily-limits/bulk`, `POST /api/sender-emails/bulk-check-missing-mx-records` | Sender updates are mostly per-account operations. | Batch common sender maintenance work: signatures, daily limits, and MX checks. | P1 | M, 1 day |
| 6 | Move leads between campaigns | `POST /api/campaigns/{id}/leads/move-to-another-campaign` | Moving a lead may require delete and recreate patterns that can lose stats history. | Use the native move endpoint so EmailBison preserves campaign history where supported. | P1 | S-M, 0.5-1.5 days |
| 7 | Auto interested categorization | `PATCH /api/workspaces/v1.1/master-inbox-settings` | We maintain our own Anthropic reply classification and ICP/reply scoring. | Evaluate enabling `auto_interested_categorization` across all 8 workspaces and decide whether it complements or duplicates our classifier. | P1 | M, 1-2 days including evaluation |
| 8 | Sequence v1.1 PUT endpoint retest | `PUT /api/campaigns/v1.1/sequence-steps/{sequence_id}` | Wave 2 saw 500 errors despite docs showing the endpoint as supported. | Empirically retest with a controlled campaign before relying on the v1.1 update path. | P1 | S, 0.5 day |

## P2 - Strategic Or Longer Effort

| # | Feature | Endpoint | Current usage | Proposed usage | Priority | Effort estimate |
| ---: | --- | --- | --- | --- | --- | --- |
| 9 | Schedule templates | `POST /api/campaigns/schedule/templates`, campaign schedule-template attachment endpoints | Campaign schedules are created/updated directly. | Standardize client campaign windows with reusable templates. | P2 | M, 1-2 days |
| 10 | Reply templates | `/api/reply-templates`, `reply_template_id` usage | Replies are largely managed by our app/automation. | Use native templates for repeatable manual or semi-automated inbox responses. | P2 | M, 1-2 days |
| 11 | Tag-based sender allocation | `POST /api/tags/attach-to-sender-emails` | Sender-pool assignment is local logic first. | Make EmailBison tags the primary allocation mechanism where it simplifies pool operations and auditability. | P2 | L, 3-5 days |
| 12 | Sequence variant activate/deactivate | `PATCH /api/campaigns/sequence-steps/{id}/activate-or-deactivate` | Variant support exists defensively but is not productized. | Support controlled activation/deactivation for A/B variants, especially the LinkedIn variants project. | P2 | M, 1-2 days |
| 13 | Headless UI iframe tokens | `POST /api/users/headless-ui-token` | We do not embed EmailBison UI surfaces. | Explore client portal embeds for inbox or campaign views if product direction needs native EmailBison UI access. | P2 | L, 3-5 days plus security review |
| 14 | Domain blacklist API | `POST /api/blacklisted-domains` and bulk blacklist endpoints | Opt-out and suppression logic is split across local and vendor systems. | Propagate domain-level opt-outs across workspaces/campaigns through native blacklist endpoints. | P2 | S-M, 0.5-1.5 days |
| 15 | Workspace-level stats endpoints | `GET /api/workspaces/v1.1/stats`, `GET /api/workspaces/v1.1/line-area-chart-stats` | Dashboard aggregation may rely on local or campaign-level reads. | Replace manual aggregation where workspace-level stats match dashboard needs. | P2 | M, 1-2 days |

## Notes For Triage

- P0 item 1 replaces the earlier "webhook signing" task. The vendor-confirmed reality is no signing support, so the local control is URL-secret validation plus fail-closed behavior.
- P0 item 2 should wait until item 1 is shipped; subscribing to more webhook events before receiver authentication would expand risk.
- P1 item 7 requires product judgment because EmailBison's native categorization could duplicate, complement, or conflict with our Anthropic-based reply classifier.
- P1 item 8 should be a narrow empirical test before any adapter refactor.
