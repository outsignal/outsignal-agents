# Pitfalls Research

**Domain:** Multi-source lead discovery, signal monitoring, Creative Ideas copy generation — adding to existing outbound lead engine
**Researched:** 2026-03-03
**Confidence:** HIGH for architectural pitfalls (grounded in existing codebase); MEDIUM for third-party API limits (official docs checked; some limits undocumented publicly)

---

## Critical Pitfalls

### Pitfall 1: Apollo.io API — Terms Prohibit What You're Building

**What goes wrong:**
You wire up Apollo's People Search and Organization Search endpoints as agent tools, run a discovery job, and get good results. Three weeks later Apollo detects that your usage pattern doesn't match a human sales rep — it looks like an automated pipeline pulling bulk results across multiple clients. Apollo rate-limits the account, then suspends it entirely. The terms explicitly prohibit: (1) using the API to replicate Apollo products/services, (2) selling or sublicensing API access, (3) using it for multiple client workspaces. Running discovery across 6 client workspaces through a shared API key violates clause 3.

**Why it happens:**
The Apollo API Terms state the license is for "internal business purposes only" and prohibit sublicensing. Running lead discovery for 6 paying clients through one Apollo key is sublicensing. Apollo monitors for burst patterns — fetching hundreds of contacts in rapid succession flags as automation. The free tier (if using it) adds an 50 AI credits limit that evaporates in a single discovery job.

**How to avoid:**
Do not use Apollo as a primary bulk discovery source. Use it for targeted enrichment (one person at a time, triggered by human request) rather than programmatic search sweeps. If Apollo search is needed at scale, each client workspace must use their own Apollo API key. Build the Apollo integration with rate delays (2-3s between calls), max daily limits per workspace, and a hard cap of 50 calls/day per key to stay under detection thresholds. Make Apollo the last fallback in discovery, not the first call.

**Warning signs:**
- Apollo returns 429 errors on previously working endpoints
- Account dashboard shows "unusual activity" flag
- Email from Apollo compliance team
- Discovery jobs complete with 0 results despite valid search params

**Phase to address:**
Phase 1 (Multi-Source Lead Discovery) — Set per-workspace API key requirement for Apollo from day one. Do not build with a shared key that "can be split later." The architecture is wrong from the start if it uses one shared key across clients.

---

### Pitfall 2: Auto-Pipeline Without a Hard Human Gate Sends Real Campaigns

**What goes wrong:**
The "evergreen signal campaign" auto-pipeline is wired as: PredictLeads signal → filter → enrich → ICP score → Creative Ideas generation → campaign create → portal notification. Everything looks controlled because it stops at "portal notification." But then someone adds auto-approve logic ("if score > 0.85 auto-approve"), or a bug in the approval check lets campaigns slip through, or a client clicks "approve all" on 200 leads from a burst funding event — and EmailBison sends to 200 companies that haven't been human-reviewed. A mis-scored lead list going out to a client's prospects kills the client relationship.

**Why it happens:**
The existing `Campaign` model already has `status: "approved"` and the EmailBison deploy route already exists. The path from signal to send has very few actual hard stops. Developers optimize for "reducing friction" and the pipeline gradually loses its gates as iterations happen. Signal burst events (100 companies raise funding same week) generate a flood that overwhelms human review capacity, creating pressure to auto-approve.

**How to avoid:**
The portal approval must be a cryptographic gate, not a status check. Specifically: (1) Campaigns created from signals must have a `requiresHumanReview: true` flag that can never be overridden by automated code — only by a human HTTP request with valid session. (2) The EmailBison deploy call must check this flag and hard-reject if `true` without a corresponding human approval event in the audit log. (3) Daily cap on signals that can enter the pipeline per client workspace (configurable, default 10/day) — excess queues without creating campaigns. (4) Signal bursts should never auto-create more than N campaigns per day per client; the rest stay in the signal feed as "pending review."

**Warning signs:**
- Pipeline telemetry shows campaigns moving from `created` to `approved` in < 60 seconds (no human reviewed that fast)
- Campaign count per client spikes on days with major funding events
- Signal monitoring cost spikes coincide with campaign creation spikes

**Phase to address:**
Phase 3 (Evergreen Signal Campaigns) — The gate architecture must be designed before auto-pipeline is built, not added as a safety net afterward. If the pipeline exists without the gate, it will ship without the gate.

---

### Pitfall 3: Cost Explosion from Signal Monitoring Burst Events

**What goes wrong:**
PredictLeads reports 85 companies raised Series A funding on the same day. Your signal monitoring cron processes all 85, triggers enrichment waterfall for each (Prospeo → AI Ark → LeadMagic → FindyMail), finds contacts at each company, runs ICP scoring via Firecrawl, and generates Creative Ideas copy via Claude Sonnet for each. At ~$0.05/email lookup + $0.10/Firecrawl crawl + $0.30/Creative Ideas generation, 85 companies × 5 contacts each = 425 enrichment calls + 85 crawls + 425 copy generations. Single burst event: ~$30-50 in external API costs, blowing through the $10/day cap and not stopping because the cap check happens at the enrichment layer, not the signal processing layer.

**Why it happens:**
The existing $10/day cost cap (from v1.0) is checked in the enrichment waterfall before each provider call. But the signal processing loop doesn't check the remaining daily budget before spawning enrichment jobs. Signals arrive as a batch from PredictLeads, each spawning independent enrichment tasks — the cap is hit in the middle of the batch, leaving half the signals partially enriched (some contacts found, some not) with inconsistent state.

**How to avoid:**
Signal monitoring must have its own budget envelope, separate from the enrichment waterfall cap. Architecture: (1) Daily signal processing budget per client workspace (default: $2/day, configurable). (2) Before processing any signals, fetch today's signal spend from the `CostLedger` (or create one). (3) Estimate cost per signal (number of contacts to enrich × avg cost per contact), reject signals that would exceed budget. (4) Process signals in priority order (funding > hiring spike > job change > news) with budget gates between each priority tier. (5) Never process more than 10 companies from a single signal type in a single cron run — queue the rest for next run.

**Warning signs:**
- Neon DB shows `CostLedger` rows summing to > $10 before 9am
- Railway cron logs show a single run processing > 20 companies
- Enrichment API dashboard shows unusual spike in calls on specific dates
- EmailBison campaign count spikes on days with major news events

**Phase to address:**
Phase 3 (Evergreen Signal Campaigns) — The cost governor must be implemented before the signal monitoring cron is wired to enrichment. Treat it as a prerequisite, not a follow-up optimization.

---

### Pitfall 4: Creative Ideas AI Hallucinating Client Services That Don't Exist

**What goes wrong:**
The Creative Ideas agent is given the client's ICP + website research and asked to generate 3 constrained, personalized ideas. It generates: "Idea 1: Help [prospect] build a whitelabel version of your XYZ product." The client doesn't have a whitelabel product. Or: "Idea 3: Offer [prospect] your API integration with Salesforce" — client has no Salesforce integration. The idea gets approved by the client who skimmed it, goes out to 50 prospects. Prospects click through expecting to learn about the Salesforce integration. It doesn't exist. Client gets confused calls, admin gets blamed.

**Why it happens:**
The Research Agent already extracts client website data into `ResearchOutput` (value props, case studies, differentiators). But Creative Ideas generation requires more constrained grounding — the agent must only reference services and capabilities that are explicitly documented in the client's research output. If the system prompt says "generate creative outreach ideas" without explicit constraints on hallucination, Claude will extrapolate from what sounds plausible for a company of that type, not what's verified.

**How to avoid:**
The Creative Ideas system prompt must include: (1) Explicit enumeration of client's actual services extracted from `ResearchOutput.valuePropositions` and `ResearchOutput.differentiators`. (2) Hard instruction: "Generate ideas ONLY using the services listed above. Do not invent capabilities the client doesn't have. If you cannot generate 3 distinct ideas from these services, generate fewer." (3) Each generated idea must include a `groundedIn` field citing which service/capability from the provided list it references. (4) Admin review of first 20 generated ideas per client before automation is enabled — catch hallucination patterns early. (5) Add a KB-backed validation step: generated idea must match at least one knowledge base chunk from the client's ingested documents.

**Warning signs:**
- Generated idea references a product/service not in `ResearchOutput.valuePropositions`
- Prospect replies "I didn't know you offered X" when X is not a real offering
- Client flags ideas as "we don't do that" during portal review

**Phase to address:**
Phase 4 (Creative Ideas Copy Framework) — The grounding constraint must be in the initial prompt design. It cannot be added after the first batch of bad ideas ships to clients. Validate with human review of 20+ examples before enabling auto-generation.

---

### Pitfall 5: Multi-Source Dedup Failure Creates Duplicate Sends

**What goes wrong:**
Apollo returns a contact: `john.doe@acme.com`, LinkedIn: `linkedin.com/in/johndoe`, name: "John Doe". Exa.ai returns the same person but with a slightly different LinkedIn URL: `linkedin.com/in/john-doe-cmo` and no email. Prospeo also returns `john.doe@acme.com` from a separate discovery job. Three records enter the pipeline. Dedup only checks `email` uniqueness (existing behavior from v1.0). The Exa result has no email so it creates a new Person record. Both Person records get added to the same TargetList. The campaign sends two emails to John Doe — one personalized to the Exa-discovered record, one to the Prospeo record. John Doe sends a "please remove me" response that becomes a spam complaint.

**Why it happens:**
The existing `Person` model uses email as the unique key (`@unique email`). This is correct for email-enriched records. But discovery sources return partial records — Exa and Serper.dev often return company + name + LinkedIn URL without email. These partial records cannot be deduplicated against existing email-keyed records at ingestion time. They must be deduplicated after enrichment, but the enrichment step that finds the email may happen asynchronously. If the same person is discovered by two sources before enrichment completes, both get persisted.

**How to avoid:**
Implement a pre-enrichment staging table (`DiscoveredPerson`) that holds raw discoveries before they're committed to `Person`. Dedup logic before promotion: (1) Exact email match — same person, merge. (2) LinkedIn URL normalized match (strip trailing slash, `/in/` prefix normalization, handle both `linkedin.com/in/X` and `www.linkedin.com/in/X`) — same person if LinkedIn URL matches. (3) Name + company domain fuzzy match (only as a flag for human review, not automatic merge). (4) Only promote to `Person` after enrichment confirms a unique email. Sources that return only LinkedIn URL go into staging, not directly into `Person`.

**Warning signs:**
- `Person` table has two records with different emails but identical `linkedinUrl`
- Same person appears twice on a TargetList
- Prospect replies "I got two emails from you" — guaranteed dedup failure
- Discovery job logs show the same LinkedIn URL processed by two sources

**Phase to address:**
Phase 1 (Multi-Source Lead Discovery) — The staging table architecture must be built before any multi-source discovery is enabled. Do not enable Exa or Serper discovery against the existing `Person` table without the staging layer.

---

### Pitfall 6: Enrichment Waterfall Reorder Breaks Existing Batch Jobs Mid-Run

**What goes wrong:**
The current waterfall is `Prospeo → AI Ark → LeadMagic → FindyMail`. The reorder to `FindyMail → Prospeo → AI Ark → LeadMagic` (cheapest first) changes which provider is called first. Existing batch jobs in the Railway worker that are mid-run when the code deploys will start calling FindyMail for new records while using the old provider order for in-flight records. Since cost tracking is per-provider, the `CostLedger` entries show FindyMail costs appearing before Prospeo costs, which breaks the cost reporting dashboard that assumes Prospeo is always column 1.

**Why it happens:**
The waterfall reorder seems like a simple config change — just swap the array order in the waterfall runner. But the waterfall state is persisted on each `Person` record (`enrichmentStatus`, provider-specific fields). Existing records that are partially enriched via Prospeo will be re-enriched by FindyMail first on the next waterfall run, wasting credits on a record that already has a Prospeo email. The cost cap logic also needs updating because FindyMail's per-credit cost differs from Prospeo's.

**How to avoid:**
(1) The reorder must be done in a single atomic deployment with no in-flight batch jobs. Schedule the reorder during off-hours with the Railway worker stopped. (2) Add a `lastEnrichedProvider` field to `Person` so the waterfall can skip providers that already ran for this record. (3) Update cost cap logic to use per-call cost constants (not per-provider cost constants) so reordering doesn't break the cap calculation. (4) Test the new order on 10 records in staging before running against the full 14.5k dataset.

**Warning signs:**
- `CostLedger` shows FindyMail charges on records that already have a Prospeo email
- Enrichment batch job shows "already enriched" skip rate drops significantly
- Cost per enriched lead increases after the reorder (sign of double-enrichment)

**Phase to address:**
Phase 6 (Enrichment Waterfall Reorder) — Treat this as a data migration, not a code change. Stop all running jobs, deploy, verify on sample, resume.

---

### Pitfall 7: Vercel 300s Timeout Kills Signal Monitoring Crons

**What goes wrong:**
Signal monitoring cron triggers on Railway (correct) but the actual PredictLeads API calls + enrichment + ICP scoring pipeline takes > 5 minutes for a batch of 20 companies. The Railway worker calls back into a Vercel API route to trigger enrichment, which times out at 300s. OR: the signal monitoring cron is accidentally registered on Vercel (not Railway) — hits the 2-cron limit on Hobby plan, plus times out on batch processing.

**Why it happens:**
The Vercel Hobby plan has a 2-cron limit (already hit with existing crons for email sync and enrichment). Adding a signal monitoring cron to Vercel would break one of the existing crons. Even on Pro, Vercel's serverless functions have a 300s hard timeout that makes multi-company processing unreliable. The Railway worker already handles the LinkedIn session refresh — adding signal monitoring to Railway is the correct call, but developers may default to Vercel because "the API routes are already there."

**How to avoid:**
Signal monitoring must run exclusively on Railway. Architecture: (1) Railway signal worker polls PredictLeads at configured intervals. (2) It writes signal events directly to Neon DB (not through Vercel API routes). (3) Enrichment triggered by signals uses the same Railway worker, calling enrichment provider SDKs directly (not via Vercel API). (4) Only final results (new Person records, campaign creation) go through a lightweight Vercel API call that's fast (< 5s). (5) Never register signal monitoring as a Vercel cron — it will silently fail on Hobby or consume the Hobby cron slots.

**Warning signs:**
- Signal monitoring cron registered in `vercel.json` (wrong)
- Vercel function logs show 300s timeout errors on enrichment calls
- Railway worker logs show successful signal fetch but no resulting Person records in DB

**Phase to address:**
Phase 2 (Signal Monitoring Infrastructure) — Architecture decision must be made before any code: Railway handles all signal processing, Vercel only handles HTTP endpoints for human-triggered actions.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Shared Apollo API key across workspaces | Ship faster, one integration | ToS violation, account suspension, discovery fails for all clients simultaneously | Never — each workspace needs its own key |
| Skip `DiscoveredPerson` staging, write directly to `Person` | Simpler schema, fewer tables | Duplicate sends to prospects, dedup bugs, partial records polluting the main DB | Never — once live, fixing requires a DB migration with 14.5k records in flight |
| Generate Creative Ideas at campaign creation (not at send time) | Simpler pipeline | Stale personalization (idea references something that happened 3 weeks ago), ideas become irrelevant | Only acceptable if ideas are re-validated within 7 days of send |
| Using `db push` instead of `prisma migrate dev` for new signal models | No migration history needed | Cannot roll back if new model causes issues; production deploy risk increases with each `db push` | Acceptable for new additive models only; never for modifying existing models with live data |
| Storing raw PredictLeads signal payloads as JSON in `SignalEvent.rawPayload` | Flexibility, no schema design needed | Cannot query signal details efficiently, reporting is slow, can't alert on specific signal properties | Acceptable for initial implementation; add typed fields after signal data patterns are understood |
| Single Railway process for both LinkedIn and signal monitoring | Fewer services to manage | LinkedIn cookies expire, require restart — restart kills signal monitoring mid-batch | Acceptable for MVP; split into separate Railway services before production load |

---

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Apollo.io API | Treating it as a bulk search tool across workspaces | Per-workspace API keys; max 50 calls/day/key; rate delay 2-3s per call; use for enrichment not discovery |
| Exa.ai Websets | Requesting 100+ results in one Webset assuming fast return | Websets with > 100 results can take 1+ hour; request 20-50 at a time, poll for completion asynchronously |
| Exa.ai Websets | Not accounting for credit burn on partial results | Credits consumed for all results found, not just returned — narrow criteria with 0 results still burns search credits |
| PredictLeads | Polling the API faster than their data refreshes | Funding events refresh at best once/day; polling > 4x/day wastes credits on duplicate signals |
| PredictLeads | Using news signal as a reliable funding signal | News events are extracted from blog posts and PR sites — funding signals have 1-3 day lag behind actual close date, multiple duplicate signals per round common |
| Serper.dev | Using Maps search for B2B companies expecting accurate employee counts | Maps API returns consumer-facing business data; employee counts, website URLs, and contact info are frequently wrong for B2B companies |
| Serper.dev | Treating social listening results as real-time | Google's index latency means Reddit/Twitter results are 1-7 days behind; not suitable for "trending now" alerts |
| Apify LinkedIn no-cookie actors | Expecting consistent data across all profile types | No-cookie actors only access publicly visible data; profiles with privacy settings return empty results without error — silent data gaps |
| Apify LinkedIn no-cookie actors | Running high-volume requests from single IP | Even without cookies, high request rates trigger LinkedIn's IP-based blocking; use Apify's residential proxy rotation |
| Railway (signal worker) | Calling Vercel API routes to trigger enrichment | Adds HTTP hop + 300s timeout risk; write directly to Neon from Railway using shared Prisma client |
| Neon PostgreSQL | Not using connection pooler for Railway long-running worker | Direct connections from Railway worker exhaust Neon's direct connection limit; always use the Neon pooled connection string in Railway |

---

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Generating Creative Ideas for every person in a TargetList at campaign creation | Campaign creation stalls for 10+ minutes; Claude API costs spike | Generate on-demand (when campaign is submitted to portal) or batch-generate in Railway worker with queue | At 50+ people per campaign |
| Loading full `Person` record for every signal event to check dedup | Railway worker memory spikes; Neon connection pool exhausted | Use `SELECT email, linkedinUrl` projection; never load full record for dedup checks | At 500+ signals per batch |
| Fetching all active signals from PredictLeads in one API call | Response timeout; large payload parsing kills Railway worker | Paginate with `page_size=100`; process pages sequentially with rate delay | At 200+ tracked companies |
| Writing SignalEvent records synchronously in signal monitoring loop | Railway worker blocks on each DB write; total batch time multiplies | Batch insert signal events; collect all events, bulk insert once per cron run | At 50+ companies per run |
| Using `prisma.person.findMany()` without index on `companyDomain` for signal lookups | Slow signal → person matching queries; Neon CPU spikes | Add `@@index([companyDomain])` to Person model; also index `linkedinUrl` | At 14.5k+ Person records (already there) |
| Storing Creative Ideas as JSON in Campaign model | Ideas cannot be queried, filtered, or compared across campaigns | Create `CreativeIdea` model with typed fields; FK to Campaign and Person | At 1k+ campaigns |

---

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Client workspace isolation in discovery jobs | One client's API key used to discover leads for a different workspace; cross-contamination of prospect data | Always pass `workspaceSlug` as the first filter in every discovery query; add DB constraint that prevents `TargetList` ↔ `PersonWorkspace` cross-workspace joins |
| Signal pipeline creates campaigns without workspace attribution | Campaigns created from signals lack `workspaceSlug`; appears in wrong client portal or not at all | Signal monitoring worker must receive `workspaceSlug` as a required param; never process signals without workspace context |
| Apollo/Exa API keys stored per-workspace in DB | API keys at rest in Neon DB; if DB is compromised, all client API keys are exposed | Encrypt per-workspace API keys at rest using AES-256 with `ENCRYPTION_SECRET` env var; never store plaintext in DB |
| Apify actor results cached without TTL | Stale LinkedIn data served as current; profile may have changed jobs | Cache Apify results with 7-day TTL maximum; always check `lastEnrichedAt` before serving cached enrichment |
| Signal monitoring exposes which companies you're tracking | If PredictLeads query params are logged or exposed, reveals client's prospect list | Never log PredictLeads query params in structured logs; signal monitoring logs show counts only, not company names |

---

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Signal dashboard shows raw PredictLeads signal types ("job_posting_added") | Admin doesn't understand what to do with the signal | Map to human labels: "Hiring Spike", "Funding Round", "Tech Adoption", "Leadership Change", "Company News" |
| Creative Ideas shown without context of which prospect they're for | Admin reviewing ideas in bulk can't evaluate relevance without re-reading prospect profile | Show prospect's title, company, and ICP match score inline with each idea in the portal review UI |
| Signal feed shows all signals for all clients in one view | Admin can't triage; Rise's signals mixed with Lime Recruitment's | Default to per-client view; global view is opt-in filter — never default to global feed |
| Discovery job shows "completed" but returns 0 results | Admin assumes the ICP doesn't have matches; doesn't investigate | Show "completed with 0 results — possible causes: [too narrow criteria / API limit reached / no matches for this ICP]" with next-step actions |
| CLI orchestrator chat has no session persistence | Conversation context lost if terminal disconnects; admin has to rebuild context | Persist CLI chat sessions to DB (`AgentRun` with `source: "cli"`) and allow `--resume [session-id]` flag |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Multi-source discovery:** Integration returns results — verify dedup staging is in place and results don't go directly to `Person` table without email confirmation
- [ ] **Signal monitoring cron:** Cron triggers and logs show signals — verify daily budget cap is enforced before enrichment starts, not after
- [ ] **Creative Ideas generation:** Claude generates ideas — verify each idea has `groundedIn` field referencing a specific client service from `ResearchOutput`; spot-check 10 ideas manually for hallucinations
- [ ] **Auto-pipeline:** Pipeline creates campaigns from signals — verify no campaign can reach `approved` status without a timestamped human approval event in the audit log
- [ ] **Exa.ai Websets:** Webset runs and returns results — verify result count matches credit deduction; check that `webset.status === "completed"` not just `"running"` before processing
- [ ] **Apollo integration:** API calls succeed — verify per-workspace key isolation; confirm no shared key fallback exists in the code
- [ ] **Enrichment waterfall reorder:** New order confirmed in code — verify no in-flight batch jobs were running at deploy time; check CostLedger for double-enrichment charges on existing records
- [ ] **Railway signal worker:** Worker starts and polls — verify it uses Neon pooled connection string (not direct), and that memory usage stays flat over 24 hours of operation
- [ ] **Per-client Creative Ideas examples:** Examples reviewed by admin — verify examples are KB-tagged and stored in knowledge base, not just in memory or a temp table
- [ ] **CLI orchestrator chat:** Chat responds to commands — verify session is persisted to DB so context survives terminal disconnect

---

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Apollo ToS violation / account suspension | HIGH | Rotate to client-owned Apollo keys immediately; audit all discovery jobs for shared key usage; contact Apollo to appeal if < 30 days old |
| Auto-pipeline sends unreviewed campaign | HIGH | Halt EmailBison sends via API immediately; send manual apology from workspace email to affected prospects; audit approval log to find the gate failure; add hard DB constraint before re-enabling |
| Cost explosion from signal burst | MEDIUM | Set emergency daily cap to $0 for affected workspaces; review CostLedger to identify runaway provider; dispute charges with providers if API error caused over-consumption |
| Creative Ideas hallucination ships to prospects | MEDIUM | Disable auto-generation immediately; manually review all in-flight campaigns; update system prompt with stricter constraints; add `groundedIn` validation before any idea is displayed in portal |
| Multi-source dedup failure creates duplicate Person records | MEDIUM | Write de-duplication script: find Persons with same `linkedinUrl`, merge PersonWorkspace records to surviving record, delete duplicates; requires offline batch job on Neon |
| Enrichment waterfall reorder causes double-enrichment | LOW | Add `skipIfEnrichedBy: [provider]` filter to waterfall runner; reset `lastEnrichedProvider` only for records without a valid email |
| Signal monitoring OOMs Railway worker | LOW | Add `--max-old-space-size=512` to Railway start command; reduce batch size from 20 to 5 companies per cron run; split LinkedIn and signal workers into separate Railway services |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Apollo ToS violation (shared key) | Phase 1 (Multi-Source Discovery) | Each workspace has its own API key config; no shared key fallback in codebase |
| Multi-source dedup failure | Phase 1 (Multi-Source Discovery) | `DiscoveredPerson` staging table exists; no direct writes to `Person` from discovery without email confirmation |
| Signal monitoring burst cost explosion | Phase 2 (Signal Monitoring) | `SignalBudget` ledger exists; signal cron checks budget before processing each company |
| Vercel 300s timeout on signal processing | Phase 2 (Signal Monitoring) | Signal cron is registered in Railway, not `vercel.json`; Railway worker writes directly to Neon |
| Auto-pipeline sends unreviewed campaigns | Phase 3 (Evergreen Signal Campaigns) | Audit log shows human approval event before any campaign reaches `approved` status; automated approval code path doesn't exist |
| Creative Ideas hallucination | Phase 4 (Creative Ideas Copy) | Every generated idea has `groundedIn` field; first 20 ideas per client are admin-reviewed before auto-generation is enabled |
| Enrichment waterfall reorder data issues | Phase 6 (Waterfall Reorder) | Reorder done during Railway worker downtime; post-deploy `CostLedger` shows no double-enrichment charges |
| Railway memory OOM from large signal batches | Phase 2 (Signal Monitoring) | Batch size capped at 10 companies per run; Railway metrics show flat memory usage over 24 hours |

---

## Sources

- [Apollo.io API Terms of Service](https://www.apollo.io/terms/api) — prohibition on sublicensing and competitive use
- [Apollo.io Rate Limits](https://docs.apollo.io/reference/rate-limits) — plan-dependent, check per endpoint
- [Exa.ai Websets FAQ](https://exa.ai/docs/websets/faq) — 10 credits per all-green result; partial results still consume credits
- [PredictLeads FAQ](https://predictleads.com/faq) — refresh rate 2x/day to 2x/week depending on company activity; 36-hour job opening refresh
- [PredictLeads Documentation](https://docs.predictleads.com/) — signal types and data freshness
- [Vercel serverless timeout issues](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out) — 300s hard max on Hobby/Pro
- [Railway resource limits](https://docs.railway.com/pricing/cost-control) — configurable per service; Pro: 24 vCPU / 24 GB RAM per replica
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling) — PgBouncer pooled connections required for serverless/worker scenarios
- [Apollo.io LinkedIn scraping enforcement](https://emailscale.io/why-did-apollo-block-apifi/) — Apollo blocked from LinkedIn ecosystem in 2025
- [AI cold email hallucination risks](https://blog.hubspot.com/sales/ai-cold-email) — HubSpot test: AI hallucinates facts, requires human verification
- [Multi-source lead deduplication pitfalls](https://community.clay.com/x/support/2boj4s1y8b4r/improving-lead-deduplication-workflow-with-clay-an) — Clay community: email + LinkedIn URL as composite dedup key
- [Outbound automation approval gates](https://reply.io/blog/outbound-ai/) — human-in-the-loop required before any automated send
- [Apify LinkedIn no-cookie actors](https://apify.com/supreme_coder/linkedin-profile-scraper) — $3/1k profiles; no account risk but returns only public data

---
*Pitfalls research for: Multi-source lead discovery, signal monitoring, Creative Ideas copy generation — v2.0 milestone*
*Researched: 2026-03-03*
