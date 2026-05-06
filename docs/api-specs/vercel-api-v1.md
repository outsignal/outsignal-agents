---
vendor: Vercel
slug: vercel
source_urls:
  - https://vercel.com/api
  - https://vercel.com/docs/rest-api/reference/endpoints/deployments/list-deployments
  - https://vercel.com/docs/rest-api/reference/endpoints/deployments/create-a-new-deployment
  - https://vercel.com/docs/rest-api/reference/endpoints/deployments/get-deployment-events
  - https://vercel.com/docs/rest-api/reference/endpoints/logs/get-logs-for-a-deployment
  - https://vercel.com/docs/rest-api/reference/endpoints/projects/create-one-or-more-environment-variables
  - https://vercel.com/docs/rest-api/errors
  - https://vercel.com/docs/cli/deploy
  - https://vercel.com/docs/cli/env
fetched: 2026-05-06T14:45:57Z
fetched_by: codex
fetch_method: WebFetch official docs + adapter audit
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
sections_missing: []
verification_notes: Official docs were available for REST API basics, deployments, deployment events, runtime logs, project env vars, errors, and CLI deploy/env commands. This covers our current Vercel usage.
last_reviewed_against_adapter: 2026-05-06T14:45:57Z
our_implementation_files:
  - vercel.json
  - scripts/preflight/check-deploy-auth.sh
  - scripts/dev-cli/deploy-status.ts
  - src/app/api/integrations/status/route.ts
empirical_audit_file: docs/audits/vercel-empirical-2026-05-06.md
redaction_policy: no tokens, no deployment protection secrets, no env var values, no request logs with PII
---

# Vercel API Documentation

## Verification Summary

- Verification status: `verified`
- Documentation confidence: `official-full`
- Phase 1 audit may proceed: `yes`
- Current blockers:
  - none for current deployment/status usage

## Authentication

Vercel REST API uses bearer tokens:

```http
Authorization: Bearer <vercel_token>
```

Current repo usage:

- `npx vercel --prod` for production deploy.
- `npx vercel whoami` in deploy auth preflight.
- `VERCEL_API_TOKEN` in `src/app/api/integrations/status/route.ts` for listing recent deployments.

## Rate Limits

Official error docs describe `rate_limited` errors with limit metadata. Endpoint-specific limits vary. Current repo usage is low-volume status/deploy tooling.

## Endpoints

### GET /v6/deployments

- Purpose: list deployments.
- Used by our code: yes.
- Query params used:

| Field | Type | Required | Default | Valid values | Notes |
| --- | --- | --- | --- | --- | --- |
| projectId | string | no | n/a | project ID or name | Code uses `cold-outbound-dashboard`. |
| limit | integer | no | API default | positive integer | Code uses `1`. |
| state | string | no | n/a | `READY`, `BUILDING`, etc. | Code filters to `READY`. |

- Response body schema:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| deployments | array | yes | Deployment records. |
| pagination | object | yes | Pagination metadata. |

### POST /v13/deployments

- Purpose: create a deployment.
- Used by our code: no direct REST usage; CLI does deployment.
- Capability note:
  - The REST API can create deployments programmatically, including git metadata and project settings, but we currently prefer the CLI for manual controlled deploys.

### GET /v3/deployments/{idOrUrl}/events

- Purpose: fetch deployment build events/logs.
- Used by our code: no.
- Capability gap:
  - Could support automated failed-deploy diagnostics.

### GET /v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs

- Purpose: stream runtime logs for a deployment.
- Used by our code: no direct current use.
- Capability gap:
  - Could replace manual Vercel dashboard log checks during canary/deploy verification.

### POST /v10/projects/{idOrName}/env

- Purpose: create/upsert environment variables.
- Used by our code: no.
- Capability gap:
  - Could support safer deploy-session token setup and env drift audits, but must be handled carefully.

## CLI

### vercel deploy

Current deploy command:

```bash
npx vercel --prod
```

Official CLI behavior:

- `vercel` from a project root deploys that project.
- `--prod` targets production.
- stdout is the deployment URL, which our runbooks record.

### vercel env

Official CLI supports listing, adding, removing, pulling, and running commands with project env vars. Our repo uses manual Vercel dashboard env management plus occasional CLI guidance.

## Webhooks

No Vercel webhook receiver is used in this repository.

## SDKs / Official Clients

Vercel offers an official SDK for REST API operations. This repo currently uses:

- Vercel CLI for deploy/auth
- direct fetch for integrations status

## Breaking Changes / Version History

No current breaking changes found for our usage. Note that REST endpoints are versioned per endpoint path (`v1`, `v3`, `v6`, `v10`, `v13`).

## Our Current Implementation

Files:

- `vercel.json` defines one cron: `/api/enrichment/jobs/process` at `0 6 * * *`.
- `scripts/preflight/check-deploy-auth.sh` checks `npx vercel whoami`.
- `scripts/dev-cli/deploy-status.ts` shells out to `vercel ls --json`.
- `src/app/api/integrations/status/route.ts` calls `GET /v6/deployments`.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| medium | Runtime logs | API can stream deployment runtime logs. | Deploy verification still relies on manual dashboard/log checks. | Consider a `deploy:verify` helper that fetches Vercel runtime logs and 5xx counts. |
| medium | Env vars | API/CLI can manage env vars. | Env updates are manual and token auth has drifted before. | Audit whether env drift checks are useful; avoid automated writes until reviewed. |
| low | Deployment events | API exposes build events. | Not used in diagnostics. | Use for failed build triage if deploy failures become common. |

## Empirical Sanity Check

- Audit file: `docs/audits/vercel-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Deployment protection can return 401/403 on preview URLs while production alias still works.
- The app code may deploy successfully while Prisma migrations are still pending; the deploy runbook must keep migration status as a separate pre-app-deploy step.
- Vercel cron is not a substitute for Trigger.dev deployment; they are separate runtimes.
