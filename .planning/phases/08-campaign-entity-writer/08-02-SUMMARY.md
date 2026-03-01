---
phase: 08-campaign-entity-writer
plan: "02"
subsystem: database
tags: [pgvector, embeddings, openai, knowledge-base, semantic-search, prisma, agents]

# Dependency graph
requires:
  - phase: 08-01
    provides: Campaign model and writer agent foundation

provides:
  - pgvector extension enabled in Neon with KnowledgeChunk table (vector(1536) embedding column)
  - embedText() and embedBatch() functions in src/lib/knowledge/embeddings.ts
  - searchKnowledge() upgraded to pgvector cosine similarity with keyword fallback
  - reembedAllDocuments() migration function for one-time re-embedding of 46+ docs
  - searchKnowledgeBase shared tool in src/lib/agents/shared-tools.ts
  - searchKnowledgeBase available in writer, leads, and orchestrator agents

affects:
  - Phase 8 remaining plans (writer agent uses semantic search)
  - Phase 9 (orchestrator uses KB directly)
  - Knowledge base ingestion scripts

# Tech tracking
tech-stack:
  added:
    - openai (npm) — text-embedding-3-small embeddings API
    - pgvector (Neon extension) — cosine similarity via <=> operator
  patterns:
    - Lazy OpenAI client initialization (avoids crash if OPENAI_API_KEY absent)
    - pgvector raw SQL via prisma.$queryRaw with ::vector cast
    - Graceful degradation: pgvector primary, keyword matching fallback
    - Shared tool pattern: extract common agent tools to shared-tools.ts

key-files:
  created:
    - src/lib/knowledge/embeddings.ts — embedText() and embedBatch() with lazy OpenAI client
    - src/lib/agents/shared-tools.ts — shared searchKnowledgeBase tool for all agents
    - scripts/reembed-knowledge.ts — one-time migration script for existing documents
  modified:
    - prisma/schema.prisma — postgresqlExtensions feature, vector extension, KnowledgeChunk model
    - src/lib/knowledge/store.ts — pgvector search, fallback, reembedAllDocuments, ingestDocument embeddings
    - src/lib/agents/writer.ts — import searchKnowledgeBase from shared-tools
    - src/lib/agents/orchestrator.ts — add searchKnowledgeBase to orchestratorTools
    - src/lib/agents/leads.ts — add searchKnowledgeBase to leadsTools
    - package.json / package-lock.json — openai dependency added

key-decisions:
  - "pgvector via Unsupported('vector(1536)') in Prisma schema — only raw SQL supported for vector operations"
  - "OpenAI client uses lazy initialization — instantiated on first call, not at module load"
  - "ingestDocument() embedding failure is non-fatal — warns to console, keyword fallback still works"
  - "searchKnowledgeBase is a shared tool (not duplicated) — all agents import from shared-tools.ts"
  - "OPENAI_API_KEY not yet set in Vercel — migration script blocked until user adds key"

patterns-established:
  - "Shared agent tools in src/lib/agents/shared-tools.ts — extract cross-agent tools here, not inline"
  - "pgvector queries use prisma.$queryRaw with Prisma.sql for safe parameterization"
  - "Graceful degradation pattern: check if pgvector data exists, fall through to keyword search on failure"

requirements-completed:
  - WRITER-08
  - WRITER-09

# Metrics
duration: 5min
completed: 2026-03-01
---

# Phase 8 Plan 02: pgvector Semantic Search for Knowledge Base Summary

**pgvector cosine similarity search via OpenAI text-embedding-3-small, with KnowledgeChunk model in Neon and searchKnowledgeBase shared across writer, leads, and orchestrator agents**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-01T09:03:41Z
- **Completed:** 2026-03-01T09:08:25Z
- **Tasks:** 3 of 3
- **Files modified:** 9

## Accomplishments

- pgvector extension enabled in Neon; KnowledgeChunk model added with `vector(1536)` embedding column and CASCADE delete
- `searchKnowledge()` upgraded to use cosine similarity (`<=>` operator) with keyword matching as graceful fallback
- `searchKnowledgeBase` extracted to `shared-tools.ts` and added to writer, leads, and orchestrator agent tool sets
- `reembedAllDocuments()` and migration script ready for when OPENAI_API_KEY is configured

## Task Commits

Each task was committed atomically:

1. **Task 1: pgvector schema + embeddings utility** - `055d913` (feat)
2. **Task 2: Upgrade searchKnowledge + migration** - `e198a8d` (feat)
3. **Task 3: Shared searchKnowledgeBase tool** - `b807c6b` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `prisma/schema.prisma` — Added postgresqlExtensions preview feature, vector extension, KnowledgeChunk model, chunksRel on KnowledgeDocument
- `src/lib/knowledge/embeddings.ts` — New: embedText(), embedBatch() with lazy OpenAI client init
- `src/lib/knowledge/store.ts` — pgvector cosine similarity search, keyword fallback, reembedAllDocuments(), ingestDocument() embedding support
- `scripts/reembed-knowledge.ts` — New: one-time migration script to re-embed all documents
- `src/lib/agents/shared-tools.ts` — New: shared searchKnowledgeBase tool (imported by writer, leads, orchestrator)
- `src/lib/agents/writer.ts` — Import searchKnowledgeBase from shared-tools (removed inline definition)
- `src/lib/agents/orchestrator.ts` — Add searchKnowledgeBase to orchestratorTools
- `src/lib/agents/leads.ts` — Add searchKnowledgeBase to leadsTools
- `package.json` / `package-lock.json` — openai dependency added

## Decisions Made

- **pgvector via Prisma Unsupported():** Prisma doesn't natively support vector types, so `Unsupported("vector(1536)")` is used in schema and all reads/writes use `prisma.$queryRaw` / `prisma.$executeRaw` with `::vector` cast.
- **Lazy OpenAI client:** The OpenAI client is created on first use, not at module load time. This avoids crashing the entire app if OPENAI_API_KEY is absent — keyword fallback still works.
- **Non-fatal embedding in ingestDocument():** If embedding fails during ingest (e.g., missing API key), a warning is logged but the document is still saved. Keyword search covers it until the key is set.
- **Shared tool pattern:** `searchKnowledgeBase` defined once in `shared-tools.ts`, imported by all agents. Previously duplicated in writer.ts only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed OpenAI client instantiation to use lazy initialization**
- **Found during:** Task 2 (running migration script)
- **Issue:** `new OpenAI()` at module top level crashed with "Missing credentials" when `OPENAI_API_KEY` absent, even for code paths that don't use embeddings
- **Fix:** Wrapped client creation in `getClient()` function called lazily on first embedding request
- **Files modified:** `src/lib/knowledge/embeddings.ts`
- **Verification:** Migration script gives clean error message; rest of app unaffected when key is absent
- **Committed in:** `e198a8d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Fix necessary for correct operation. Prevents app-wide crash in production if OPENAI_API_KEY ever goes missing.

## Issues Encountered

**OPENAI_API_KEY not in Vercel env vars:** The migration script (`scripts/reembed-knowledge.ts`) and semantic search require an OpenAI API key, which is not currently set in Vercel or any local env file. The key is not in the project's Vercel environment. All code is implemented and correct — the migration is blocked pending the key.

**Workaround in place:** `searchKnowledge()` automatically falls back to keyword matching when the KnowledgeChunk table is empty (0 records). The knowledge base continues to work as before until the key is added and migration runs.

## User Setup Required

To enable pgvector semantic search, the user must:

1. **Add OPENAI_API_KEY to Vercel:**
   ```bash
   printf "sk-..." | vercel env add OPENAI_API_KEY production
   ```

2. **Add OPENAI_API_KEY locally** (for running the migration):
   ```bash
   echo 'OPENAI_API_KEY="sk-..."' >> .env
   ```

3. **Run the migration script** (re-embeds all 46+ documents):
   ```bash
   npx tsx scripts/reembed-knowledge.ts
   ```

4. **Verify:**
   ```bash
   node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); p.knowledgeChunk.count().then(c => { console.log('Chunks:', c); p.\$disconnect(); })"
   ```
   Should show > 0 chunks.

Until then, keyword search is the active fallback.

## Next Phase Readiness

- pgvector infrastructure is fully deployed in Neon — table exists, extension active
- All agent code is ready — searchKnowledgeBase available in writer, leads, orchestrator
- Migration script ready to run as soon as OPENAI_API_KEY is provided
- Plan 08-03 can proceed (writer agent uses shared tool, works with keyword fallback today)

---
*Phase: 08-campaign-entity-writer*
*Completed: 2026-03-01*
