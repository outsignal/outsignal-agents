---
vendor: Trigger.dev
slug: triggerdev
source_urls:
  - https://trigger.dev/docs
  - https://trigger.dev/docs/tasks-overview
  - https://trigger.dev/docs/triggering
  - https://trigger.dev/docs/queue-concurrency
  - https://trigger.dev/docs/errors-retrying
  - https://trigger.dev/docs/wait
  - https://trigger.dev/docs/management/tasks/batch-trigger
  - https://trigger.dev/docs/management/errors-and-retries
  - docs/briefs/2026-04-21-trigger-stale-deploy-incident.md
fetched: 2026-05-06T14:45:57Z
fetched_by: codex
fetch_method: WebFetch official docs + repo/memory references
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
  - dead_letter_queues
verification_notes: Official docs were reviewed for tasks, schedules, triggering, batch triggering, queues, waits, retries, and management API error handling. No dedicated dead-letter-queue feature was found in the reviewed docs; reliability appears to be handled through retries, dashboard replay/manual retry, catchError, AbortTaskRunError, and application-level logging. Trigger.dev CLI deploy gotchas are folded in from the local `reference_triggerdev_deploy_preflight` memory note.
last_reviewed_against_adapter: 2026-05-06T14:45:57Z
our_implementation_files:
  - trigger.config.ts
  - trigger/queues.ts
  - trigger/process-reply.ts
  - trigger/campaign-deploy.ts
  - trigger/generate-suggestion.ts
  - trigger/enrichment-processor.ts
  - trigger/weekly-analysis.ts
  - src/app/api/background-tasks/route.ts
  - src/app/api/integrations/status/route.ts
  - scripts/preflight/check-deploy-auth.sh
empirical_audit_file: docs/audits/triggerdev-empirical-2026-05-06.md
redaction_policy: no tokens, no secrets, no payloads containing customer/reply data, no run logs with PII
---

# Trigger.dev API Documentation

## Verification Summary

- Verification status: `incomplete`
- Documentation confidence: `official-partial`
- Phase 1 audit may proceed: `yes-with-confidence-warning`
- Current blockers:
  - Exact management API schemas for all endpoints we use were not fully captured.
  - Dedicated dead-letter queue semantics were not found in docs reviewed.
  - Deploy CLI behavior has important project/version gotchas captured in local memory rather than official docs.

## Authentication

Runtime and management API calls use Trigger.dev API keys.

Current repository configuration:

- `trigger.config.ts` reads `TRIGGER_PROJECT_REF` at deploy/build time.
- `src/app/api/background-tasks/route.ts` calls `https://api.trigger.dev/api/v1` with `TRIGGER_SECRET_KEY`.
- `scripts/preflight/check-deploy-auth.sh` runs `npx trigger.dev@<installed-sdk-version> whoami`.

Auth gotcha:

- `TRIGGER_SECRET_KEY` is for runtime/API calls. It is not the same as CLI deploy authentication.

## Rate Limits

Official rate limits were not captured as a static table in this Wave 3 pass.

Relevant control surfaces:

- task-level retry
- SDK request retry
- queues and concurrency limits
- batch trigger limits
- environment concurrency limits

## Endpoints / SDK Surfaces

### task()

- Purpose: define a regular task.
- Used by our code: yes.
- Request body schema: TypeScript payload type per task.
- Response/output: JSON-serializable return value.
- Current tasks include campaign deploy, reply processing, suggestions, LinkedIn fast-track, smoke test, and others.

### schedules.task()

- Purpose: define a scheduled task.
- Used by our code: yes.
- Current scheduled tasks include inbox checks, domain health, credit monitor, weekly analysis, enrichment processor, usage report, and other operational jobs.

### tasks.trigger()

- Purpose: trigger a task and get a run handle.
- Used by our code: yes.
- Used from API routes and tasks, especially:
  - campaign deploy
  - process reply
  - EmailBison webhook follow-on work

### tasks.batchTrigger() / batch.trigger()

- Purpose: trigger one task many times, or trigger multiple tasks in one batch.
- Used by our code: no.
- Capability gap:
  - Useful for fan-out workloads such as batch enrichment, batch classification retry, and large discovery follow-ups.
  - Current app loops and custom DB queues may duplicate functionality Trigger can provide.

### queue()

- Purpose: define named queues and concurrency limits.
- Used by our code: yes.
- Current queues:
  - `anthropic-queue`, concurrency 3
  - `emailbison-queue`, concurrency 3

Known local gotcha:

- In Trigger.dev v4, pre-declared queues are required. Inline concurrency limits were observed to be silently ignored in this codebase history.

### retry options

- Purpose: retry task attempts after thrown errors.
- Used by our code: yes.
- Official docs support retry config with max attempts, backoff factors, min/max timeout, randomization, `catchError`, `retry.onThrow`, `retry.fetch`, and `AbortTaskRunError`.

Capability gap:

- We use task-level retries but do not broadly use conditional retry behavior such as `catchError`, `AbortTaskRunError`, or `retry.fetch` for vendor-specific 429/4xx handling.

### wait.for() / wait.until() / triggerAndWait()

- Purpose: checkpoint long waits and DAG-style workflows without keeping compute active.
- Used by our code: limited or not visible.
- Capability gap:
  - Campaign deploy, enrichment, and reply workflows could be modeled as explicit DAGs with subtask waits instead of bespoke state polling.

### GET /api/v1/runs

- Purpose: list recent runs.
- Used by our code: yes, through `src/app/api/background-tasks/route.ts` and integrations status.
- Query examples in code:
  - `/runs?filter[createdAt][period]=1d&page[size]=100`
  - `/runs?limit=1`

### GET /api/v1/schedules

- Purpose: list schedules.
- Used by our code: yes, through background tasks admin route.

## Webhooks

Trigger.dev runs our webhook-triggered follow-up work, but Trigger.dev itself is not a webhook receiver contract in this wave.

## SDKs / Official Clients

The repository uses:

- `@trigger.dev/sdk` `^4.4.3`
- `@trigger.dev/build` `^4.4.3`
- CLI invoked through `npx trigger.dev@<installed-sdk-version>`

## Breaking Changes / Version History

Local deploy history shows CLI/SDK patch version mismatch can block deploys. Use the installed SDK version, not `@latest` or a package.json range.

## Our Current Implementation

Implementation:

- `trigger.config.ts` with `maxDuration: 300`, `dirs: ["./trigger"]`, Prisma build extension, and global `onFailure` Slack alert.
- 20+ task files under `trigger/`.
- Admin APIs query Trigger runs/schedules through REST endpoints.
- Preflight script checks CLI auth.

## Mismatches Between Docs And Our Adapter

| Severity | Area | Spec says | Adapter does | Phase 1 recommendation |
| --- | --- | --- | --- | --- |
| high | Batch triggering | SDK supports batch trigger with many payloads. | Not used for fan-out workloads. | Evaluate for enrichment/scoring/retry fan-out. |
| high | Conditional retries | Docs support `catchError`, `AbortTaskRunError`, `retry.fetch`, and `retry.onThrow`. | Mostly task-level retry only. | Add vendor-aware retry/abort logic to avoid retrying permanent 4xx/credit failures. |
| medium | Waits/DAGs | Waits checkpoint and release concurrency. | Workflows often use custom DB queues/polling. | Consider DAG-style refactor for campaign deploy and enrichment in later phases. |
| medium | Management API | Admin route fetches runs/schedules directly. | Exact schema and pagination not runtime-validated. | Add runtime schema validation before expanding admin controls. |
| low | Dead-letter queues | No dedicated DLQ found in reviewed docs. | Failures alert through global `onFailure` Slack hook. | If DLQ is needed, implement app-level failure table or verify a Trigger feature exists. |

## Empirical Sanity Check

- Audit file: `docs/audits/triggerdev-empirical-2026-05-06.md`
- Production samples checked: `0`
- Undocumented fields observed: `pending`
- Documented fields never observed: `pending`

## Known Limitations / Quirks

Deploy preflight gotchas captured from local memory:

1. CLI version must match the installed `@trigger.dev/sdk` version.
2. `TRIGGER_PROJECT_REF` must be present in the deploy shell.
3. Project ref is not the dashboard URL slug.
4. package.json dependency range is not the installed SDK version.
5. `SDK_VERSION` must be set in a separate shell command before using it in `npx trigger.dev@"$SDK_VERSION" deploy`.

Canonical deploy pattern:

```bash
SDK_VERSION="$(node -p "require('@trigger.dev/sdk/package.json').version")"
TRIGGER_PROJECT_REF=proj_difpmdhrzxdwuxzzeney npx trigger.dev@"$SDK_VERSION" deploy
```
