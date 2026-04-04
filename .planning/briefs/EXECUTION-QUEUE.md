# Execution Queue — Pipeline Reliability & Quality

Date: 2026-04-03
Prepared by: PM session
For: Implementation agent (next Claude Code session)

## Context

The Outsignal agent pipeline has critical gaps: enrichment jobs silently fail, discovery burns credits on inline enrichment, rate limits are generic not provider-specific, and quality gates are missing. These 7 briefs fix the pipeline end-to-end.

**Project location:** `/Users/jjay/programs/outsignal-agents`
**Stack:** Next.js 16, Prisma 6, PostgreSQL (Neon), Trigger.dev, Vercel
**Deploy flow:** Do NOT push or deploy until explicitly asked. `git add -> commit` only.
**Trigger.dev deploy:** `npx trigger.dev@latest deploy` (clean `.trigger/tmp/` first if >1GB)

---

## Tier 1: Critical (blocking campaigns)

These must be done first, in order. Each unblocks the next.

### 1. Decouple Discovery from Enrichment
**Brief:** `.planning/briefs/decouple-discovery-enrichment.md`
**Why critical:** Discovery adapters run the full enrichment waterfall INLINE during search. This burns credits before ICP filtering, triggers AI Ark 401s, and makes discovery take minutes instead of seconds.
**Scope:**
- Strip enrichment from `src/lib/discovery/adapters/prospeo-search.ts` and `aiark-search.ts`
- Keep Leads Finder actor-provided emails (don't strip those)
- Ensure `DiscoveredPerson` staging accepts `email: null`
- Ensure `discovery-promote.js` creates `EnrichmentJob` for people missing verified emails
- Wire `getEnrichmentRouting` for LinkedIn-only campaigns (skip enrichment)
**Depends on:** Nothing
**Unblocks:** Items 2 and 3 (enrichment processor handles post-discovery enrichment)

### 2. Enrichment Job Processor — Fix 4 Bugs
**Brief:** `.planning/briefs/enrichment-job-processor.md` (updated 2026-04-03 with review findings)
**Why critical:** The Trigger.dev task (`trigger/enrichment-processor.ts`) already exists but has 4 bugs found during code review. Without fixes, credit-exhaustion-paused jobs are orphaned forever, crashed jobs never recover, and the task can exceed maxDuration.
**Scope:** (all 4 fixes are in the brief with exact code)
1. **BUG:** `src/lib/enrichment/queue.ts` — credit exhaustion sets `resumeAt: null`, job orphaned. Fix: set `resumeAt` to 1 hour.
2. **GAP:** `trigger/enrichment-processor.ts` — add stale "running" job recovery at start of run (>10 min = reset to pending).
3. **RISK:** `trigger/enrichment-processor.ts` — add elapsed-time guard (break at 240s, leave 60s buffer).
4. **RISK:** `trigger/enrichment-processor.ts` — add `concurrencyLimit: 1` to prevent overlapping runs picking same job.
**Depends on:** Item 1 (the processor is the async handler for enrichment jobs created by decoupled discovery)

### 3. API Rate Limits Per Provider
**Brief:** `.planning/briefs/api-rate-limits-per-provider.md`
**Why critical:** Generic rate limits cause 429/401 errors (too aggressive) or unnecessary slowness (too conservative). Each provider has documented limits.
**Scope:**
- Add `RATE_LIMITS` constants to each adapter with actual provider-specific values
- Prospeo: 1 req/s, 500 domains/batch, 25 results/page
- AI Ark: 5 req/s, 300 req/min, 200ms between export calls, 5-10 min cooldown on 401
- BounceBan: 5 req/s
- Kitt: 2 req/s
- FindyMail: 2 req/s
- EmailBison: 2 req/s, 15 results/page
**Depends on:** Item 1 (adapters are being modified anyway, do rate limits in the same pass)

---

## Tier 2: Important (quality and reliability)

Do after Tier 1. Order within tier is flexible.

### 4. Discovery Pipeline Quality Gates
**Brief:** `.planning/briefs/discovery-pipeline-quality.md`
**Why important:** BlankTag pipeline produced 994 records — 249 dupes, 310 off-ICP. No pre-search dedup, no ICP title filtering, no company-type filtering.
**Scope:**
- `getUncoveredDomains(workspaceSlug, domains)` — skip already-covered domains
- Dedup at staging (not promotion) — check linkedinUrl or firstName+lastName+companyDomain
- ICP title filtering after search (exclude Volunteer, Board Member, Photographer, etc.)
- Company-type filtering (exclude non-profits, media, government)
**Depends on:** Item 1 (adapters must be decoupled before adding quality gates)

### 5. Writer Agent Memory Depth
**Brief:** `.planning/briefs/writer-memory-depth.md`
**Why important:** Writer onComplete only records a one-liner. Copy angles, proof points, client feedback, and variant details are lost between sessions.
**Scope:**
- Richer onComplete hook in `src/lib/agents/writer.ts` (lines 707-723) — record angles, proof points, closing style, variant count
- Client feedback recording to `.nova/memory/{slug}/feedback.md` with timestamp and attribution
- Campaign content summary to `.nova/memory/{slug}/campaigns.md` with structured format
**Depends on:** Nothing (independent of pipeline work)

### 6. Pagination & API Client Enforcement
**Brief:** `.planning/briefs/pagination-and-api-clients.md`
**Why important:** Agents bypass established clients with raw `fetch()`, causing pagination bugs (EB showed 15/59 senders, missing 44).
**Scope:**
- Already addressed via `.claude/rules/api-client-rules.md` (rule exists)
- Verify all agent code paths use clients, not raw fetch
- Add missing CLI scripts for common queries if agents lack a proper tool
**Depends on:** Nothing (can be done in parallel with item 5)

---

## Tier 3: Operational

### 7. Monty Radar Credit Monitoring
**Brief:** `.planning/briefs/monty-credit-monitoring.md`
**Why:** We've been caught by exhausted credits (AI Ark at 0, FindyMail at 0) without warning. Need daily proactive checks.
**Scope:**
- Add daily credit balance check to the Monty Radar health system
- Hit each provider API: Prospeo, AI Ark (proxy check), FindyMail, Apify, Adyntel
- Alert via ntfy + Slack when below warning/critical thresholds
- Integrate into existing `GET /api/health/radar` endpoint
**Depends on:** Nothing (standalone)

---

## Dependency Graph

```
1. Decouple Discovery
       |
       +---> 2. Enrichment Processor Bugs (depends on 1)
       |
       +---> 3. API Rate Limits (same adapter files as 1)
       |
       +---> 4. Quality Gates (depends on 1)

5. Writer Memory Depth (independent)
6. Pagination Enforcement (independent)
7. Monty Credit Monitoring (independent)
```

Items 5, 6, 7 can run in parallel with Tier 1. Items 2, 3, 4 depend on item 1.

---

## Rules to Follow

- **PM role**: You are implementing, not managing. Read the briefs, read the code, make the changes.
- **Read before edit**: Always read the target file before modifying it. Understand existing patterns.
- **No push/deploy**: `git add -> commit` only. User will deploy when ready.
- **Test changes**: Run `npx tsc --noEmit` after TypeScript changes. Run relevant tests if they exist.
- **Existing patterns**: Follow the patterns already in the codebase (module-scope PrismaClient in trigger tasks, LOG_PREFIX convention, etc.)
- **Atomic commits**: One commit per brief item, with a clear message describing what changed and why.
