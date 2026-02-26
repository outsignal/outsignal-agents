# Phase 3: ICP Qualification + Leads Agent - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Qualify prospects against ICP criteria using web research + enrichment data, gate email exports through LeadMagic verification, expose all pipeline capabilities through MCP server tools for Claude Code, and support workspace-specific AI prompt overrides for ICP scoring, normalization, and outreach tone.

</domain>

<decisions>
## Implementation Decisions

### ICP Scoring
- Numeric score 0-100 per person, not pass/fail or tiered
- Every score includes a 1-3 sentence text reasoning explaining why the prospect scored that way
- Scoring inputs: company website crawl (Firecrawl) + enrichment data from Phase 2 providers (headcount, industry, job title) + LinkedIn profile data if available
- Cache crawl results to prevent re-crawling the same company website
- Persist ICP score and reasoning on the person record

### Missing Data Handling
- Claude's discretion — likely a hybrid: score with available data but include a confidence/completeness indicator, flag for review if too sparse

### Leads Agent
- Built as MCP server tools for Claude Code — NOT a browser chat UI
- Uses Max Plan subscription ($0 AI cost) — no Claude API calls needed
- Only the project owner uses this, not clients
- Hybrid conversational style: accepts natural language input, returns structured data (tables, lists)
- Session memory across messages within a Claude Code conversation
- Confirms before expensive actions (enrichment calls, exports)
- 6 capabilities:
  1. Enrich a person (trigger waterfall)
  2. Search people (filter by fields)
  3. Build a list (create/manage named lists)
  4. Trigger export to EmailBison
  5. Score a prospect or batch-score a list
  6. Update lead status (interested, replied, bounced)

### Email Verification
- Verify on export to EmailBison only — NOT on enrichment or on demand
- Use LeadMagic verification API
- Persist verification result on the person record in the database
- Only re-verify if the same lead is being re-exported (stale check)
- Invalid emails: block from export, show "verification failed" badge in UI
- Risky/catch-all emails: also blocked from export (strict policy)
- Cache verification result permanently — no automatic re-verification

### Workspace AI Customization
- Three freeform text prompt fields per workspace, stored in DB:
  1. ICP criteria prompt (e.g., "Our ideal customer is a SaaS company with 50-200 employees in the UK")
  2. Normalization rules prompt (e.g., "Classify 'promo products' as 'Branded Merchandise'")
  3. Outreach tone prompt (e.g., "Professional but friendly, mention their recent funding round")
- Managed via MCP tools in Claude Code — no admin UI needed
- Only the project owner configures these, clients don't access them directly
- AI pipeline reads workspace prompts when scoring/normalizing/generating

### Claude's Discretion
- MCP tool naming and schema design
- Exact ICP scoring algorithm (how to weight different signals)
- How to handle missing data during scoring (confidence indicator approach)
- Firecrawl crawl caching strategy (TTL, storage format)
- LeadMagic verification API integration details
- Session memory implementation approach

</decisions>

<specifics>
## Specific Ideas

- The Leads Agent should feel like talking to a knowledgeable sales ops assistant in Claude Code
- Workspace prompts should be simple enough that you can set them conversationally: "set Rise ICP to SaaS companies, 50-200 employees in UK"
- Email verification is a cost-control mechanism — verify late (on export), cache permanently, re-verify only on re-export

</specifics>

<deferred>
## Deferred Ideas

- Browser-based chat UI for the Leads Agent — could be added in a future phase if clients need self-service access (would require Claude API costs)
- Automatic bulk re-verification of stale emails — not needed if verification happens on export

</deferred>

---

*Phase: 03-icp-qualification-leads-agent*
*Context gathered: 2026-02-26*
