# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-26)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** Phase 1 — Enrichment Foundation

## Current Position

Phase: 1 of 5 (Enrichment Foundation)
Plan: 3 of TBD in current phase
Status: In progress
Last activity: 2026-02-26 — Completed 01-03 (async job queue)

Progress: [██░░░░░░░░] ~10%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: ~3 min
- Total execution time: ~8 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-enrichment-foundation | 3 | ~8 min | ~2.7 min |

**Recent Trend:**
- Last 5 plans: 01-01 (schema), 01-02 (normalizers), 01-03 (async queue)
- Trend: Fast (all < 5 min)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-phase]: Waterfall enrichment order — Prospeo → AI Ark → LeadMagic → FindyMail for email; AI Ark → Firecrawl for company
- [Pre-phase]: Async job queue pattern needed before any batch enrichment — Vercel 30s timeout risk
- [Pre-phase]: Provider-agnostic EnrichmentProvider interface must exist before any provider adapter is written
- [Pre-phase]: Field-level merge precedence rules must be defined before first enrichment write (prevents overwriting good data)
- [01-01]: Used db push instead of migrate dev — project has no migration history (db push pattern), migrate dev would have reset production data with 14,563+ records
- [01-01]: recordEnrichment creates new rows (not upsert) to preserve full enrichment history including retries
- [01-01]: fieldsWritten/rawResponse stored as JSON strings in TEXT columns — consistent with existing schema pattern (techStack, enrichmentData, etc.)
- [01-02]: Rule-based fast path before AI calls — exact/regex match (free) before Claude Haiku (cheap) for all classifiers
- [01-02]: Low-confidence AI responses treated as null/fallback — prevents propagating uncertain data downstream
- [01-02]: classifyCompanyName falls back to rule-based result (not null) on AI error — preserves partial normalization quality
- [01-02]: All-uppercase titles (e.g., "CEO") bypass rule-based fast path via isCleanTitle heuristic, get AI treatment
- [01-03]: onProcess callback defaults to no-op in Phase 1 — separates queue mechanics from provider logic, enables isolated testing
- [01-03]: Job returns to pending (not running) between chunks — natural FIFO pickup by cron without special resume logic
- [01-03]: Individual entity errors accumulated in errorLog without failing the job — allows partial success on large batches

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: AI Ark API shape is LOW confidence from research — verify exact endpoint/response schema at aiark.com docs before implementing adapter
- [Phase 2]: FindyMail API shape is LOW confidence — verify before implementation
- [Phase 5]: EmailBison campaign lead push endpoint not yet confirmed — research before Phase 5 planning

## Session Continuity

Last session: 2026-02-26
Stopped at: Completed 01-03-PLAN.md — async job queue built and tested
Resume file: None
