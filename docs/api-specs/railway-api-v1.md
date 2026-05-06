---
vendor: Railway
slug: railway
source_urls:
  - https://docs.railway.com/integrations/api
  - https://docs.railway.com/guides/manage-deployments
  - https://docs.railway.com/guides/manage-variables
  - https://docs.railway.com/guides/manage-environments
fetched: 2026-05-06T14:45:57Z
fetched_by: codex
fetch_method: WebFetch official docs + adapter audit
verification_status: incomplete
doc_confidence: official-partial
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
  - cli_json_contract
verification_notes: Official Public API docs were available for GraphQL, deployments, variables, environments, logs, redeploys, restarts, rollbacks, and deployment statuses. The exact Railway CLI `status --json` output contract and token env-var behavior still need CLI/manual confirmation.
last_reviewed_against_adapter: 2026-05-06T14:45:57Z
our_implementation_files:
  - worker/railway.toml
  - worker-signals/railway.toml
  - scripts/preflight/check-deploy-auth.sh
  - src/app/api/integrations/status/route.ts
empirical_audit_file: docs/audits/railway-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no env var values, no runtime logs with PII or LinkedIn session data
---

# Railway API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Exact `railway status --json` schema is not documented here.
  - Token env-var behavior (`RAILWAY_API_TOKEN` vs legacy `RAILWAY_TOKEN`) needs CLI confirmation.
  - Runtime log schemas need empirical redacted samples before automation.

## Authentication

Railway Public API is GraphQL and requires an API token.

Current repository usage:

- `railway whoami` in deploy auth preflight.
- `railway status --json` in deploy verification runbooks.
- Railway-hosted worker health is checked by app code via `LINKEDIN_WORKER_URL/health`, not Railway's API.

## Rate Limits

Rate limits were not captured as a static table in the official docs reviewed. Current usage is low-volume deploy/status verification.

## Endpoints / GraphQL Surfaces

### Public API GraphQL endpoint

- Purpose: manage Railway projects, services, deployments, variables, environments, and logs.
- Used by our code: no direct GraphQL calls.
- Used operationally: Railway CLI.

### Deployment queries and mutations

Official docs cover:

- list deployments
- get a single deployment
- get latest active deployment
- get build logs
- get runtime logs
- get HTTP logs
- trigger redeploy
- restart deployment
- rollback
- stop/cancel/remove deployment
- deploy a specific service in an environment

Deployment statuses include:

- `BUILDING`
- `DEPLOYING`
- `SUCCESS`
- `FAILED`
- `CRASHED`
- `REMOVED`
- `SLEEPING`
- `SKIPPED`
- `WAITING`
- `QUEUED`

Current operational requirement:

- `railway status --json | grep commitHash` should match `git rev-parse origin/main`.
- Deployment status must be `SUCCESS`.

### Variable operations

Official docs cover:

- get variables
- get unrendered variables
- create/update one variable
- upsert many variables
- delete variable
- get rendered variables for deployment
- variable references between services
- staged changes / `skipDeploys` patterns for safe rotation

Capability gap:

- Could support a safer env drift audit for worker tokens and worker URLs, but automated writes should be avoided until token scope and environment targeting are airtight.

### Environment operations

Official docs cover listing, reading, creating, renaming, deleting, fetching environment logs, and staged changes.

## Webhooks

No Railway webhook receiver is used by this repo.

## SDKs / Official Clients

Official docs show GraphQL examples with cURL, JavaScript, Python, and other snippets. The repo currently uses Railway CLI and HTTP health checks rather than an SDK.

## Breaking Changes / Version History

No breaking changes affect current usage. Phase 1 should verify CLI token env-var changes because deploy work recently hit token-name confusion.

## Our Current Implementation

Files:

- `worker/railway.toml`: Dockerfile builder, restart policy always.
- `worker-signals/railway.toml`: Dockerfile builder, cron every 6 hours.
- `scripts/preflight/check-deploy-auth.sh`: `railway whoami`.
- `src/app/api/integrations/status/route.ts`: checks worker health URL.

Railway-hosted workloads:

- LinkedIn worker
- Signal worker

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Deployment verification | Public API exposes deployment status and commit/log data. | Runbooks rely on CLI `railway status --json` and grep. | Consider a typed verification script using GraphQL or validated CLI JSON. |
| medium | Runtime logs | Public API can fetch build/runtime/HTTP logs. | Logs are checked manually through CLI/dashboard. | Add read-only log fetch helper for deploy verification. |
| medium | Variable rotation | API supports staged variable changes and `skipDeploys`. | Token/env refresh is manual and recently caused deploy friction. | Design env drift/rotation workflow before automated writes. |
| low | Worker health | App checks `/health` on worker URL. | Does not cross-check Railway deployment status directly. | Keep both health and deployment status checks in deploy runbook. |

## Empirical Sanity Check

- Audit file: `docs/audits/railway-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

- Railway worker can be ahead of schema if app deploys before migrations; migration step remains separate from Railway auto-deploy.
- `railway status --json` is operationally useful but not yet schema-validated in this repo.
- Worker logs can contain LinkedIn session/debug data; empirical samples must be aggressively redacted.
