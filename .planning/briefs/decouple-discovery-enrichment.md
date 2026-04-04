# Brief: Decouple Discovery from Enrichment

## Problem
The discovery adapters (`src/lib/discovery/adapters/*.ts`) run the full enrichment waterfall INLINE during search. When the Leads agent searches for people, every result immediately triggers:
1. Prospeo bulk-enrich (email finding)
2. AI Ark export (email finding fallback)
3. Kitt find_email (final fallback)
4. BounceBan verification

This causes:
- **Burnt credits during discovery** — enrichment credits consumed before we even know if the leads are ICP-fit
- **AI Ark rate limits** — export calls during search trigger 401 errors that block further searches
- **Slow discovery** — each page of results takes minutes instead of seconds because of inline enrichment
- **No separation of concerns** — can't discover leads without paying for enrichment
- **Pipeline break** — the enrichment processor (Trigger.dev task) was built to handle enrichment asynchronously, but the adapters do it inline, making the processor redundant for adapter-sourced leads

## Current Flow (broken)
```
Search adapter called
    → Fetch results from API (Prospeo/AI Ark/Apollo)
    → FOR EACH result:
        → Prospeo bulk-enrich (email finding) — COSTS CREDITS
        → AI Ark export (fallback) — COSTS CREDITS
        → Kitt find_email (fallback) — COSTS CREDITS
        → BounceBan verify — COSTS CREDITS
    → Stage enriched results in DiscoveredPerson
```

## Required Flow (fixed)
```
Search adapter called
    → Fetch results from API (Prospeo/AI Ark/Apollo)
    → Return IDENTITY DATA ONLY (name, title, company, LinkedIn URL)
    → Stage raw results in DiscoveredPerson (no enrichment)
    
Later, when promoted via discovery-promote:
    → Create EnrichmentJob with status: pending
    → Enrichment processor (Trigger.dev) picks up the job
    → Runs waterfall: Prospeo → AI Ark → FindyMail → Kitt → BounceBan
    → Updates Person records with verified emails
```

## Changes Required

### 1. Strip enrichment from discovery adapters
In each adapter file, remove or disable the inline enrichment calls:
- `src/lib/discovery/adapters/prospeo-search.ts` — remove Prospeo bulk-enrich calls after search
- `src/lib/discovery/adapters/aiark-search.ts` — remove AI Ark export calls after search
- `src/lib/discovery/adapters/apify-leads-finder.ts` — this one is different: Leads Finder returns verified emails FROM the actor, so keep those. Don't strip actor-provided emails, but don't run additional enrichment on top.
- All other adapters — verify they don't have inline enrichment

### 2. Ensure DiscoveredPerson accepts null emails
The staging function should accept people with `email: null` — discovery finds identity, enrichment finds email later.

### 3. Ensure discovery-promote creates EnrichmentJob
When `discovery-promote.js` promotes people to the Person table, it must create an EnrichmentJob for people missing verified emails. The enrichment processor (Trigger.dev task) then handles them asynchronously.

### 4. Channel-aware enrichment skip
If the campaign is LinkedIn-only (like BlankTag), the enrichment job should be skipped entirely — no email finding needed. The Leads agent already has `getEnrichmentRouting` for this. Ensure it's wired into the promotion flow.

## Key Files
- `src/lib/discovery/adapters/prospeo-search.ts` — inline enrichment to remove
- `src/lib/discovery/adapters/aiark-search.ts` — inline enrichment to remove
- `src/lib/discovery/adapters/apify-leads-finder.ts` — keep actor-provided emails, remove additional enrichment
- `src/lib/discovery/staging.ts` — ensure null email acceptance
- `scripts/cli/discovery-promote.js` — ensure EnrichmentJob creation
- `trigger/enrichment-processor.ts` — the async processor (already built)
- `src/lib/enrichment/queue.ts` — processNextChunk

## Success Criteria
1. Discovery searches return in seconds, not minutes
2. Zero enrichment credits consumed during discovery
3. No AI Ark rate limits triggered by discovery searches
4. Enrichment happens asynchronously via the Trigger.dev processor only
5. LinkedIn-only campaigns skip enrichment entirely
6. People with null emails are staged correctly and enriched later
