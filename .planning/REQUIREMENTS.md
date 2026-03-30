# Requirements: Outsignal Agent Quality Overhaul

**Defined:** 2026-03-30
**Core Value:** Make agent team produce campaign-ready output without manual QA — expert lead sourcing, first-time-right copy, validated pipeline.

## v8.0 Requirements

Requirements for the agent quality overhaul. Each maps to roadmap phases.

### Leads Quality

- [ ] **LEAD-01**: Leads agent recommends optimal sourcing route per campaign (platforms, filters, reasoning) and waits for approval
- [ ] **LEAD-02**: Two-path search routing — if company domains available, search by domain; if ICP filters only, build optimal filter combinations from ICP data. Agent knows which path and why.
- [ ] **LEAD-03**: AI Ark keyword searches use two-step company-then-people workaround (enforced at CLI wrapper level)
- [ ] **LEAD-04**: Post-search quality gate — reports % with real emails, % with LinkedIn URLs, ICP fit score; flags if below threshold before promotion
- [ ] **LEAD-05**: Channel-aware enrichment — LinkedIn-only campaigns skip email enrichment entirely; email and hybrid campaigns get both email + LinkedIn URLs. Always get LinkedIn URLs.
- [ ] **LEAD-06**: Unverified/CATCH_ALL emails routed through BounceBan/LeadMagic verification (not discarded)
- [ ] **LEAD-07**: Pre-search input validation — sanity-check filters against workspace ICP before paid API calls
- [ ] **LEAD-08**: Credit estimation before discovery execution (estimated cost shown in plan, actual cost reported after)
- [ ] **LEAD-09**: Platform expertise encoded in leads-rules.md — optimal filters, cost models, rate limits, common mistakes, best practices per platform (Prospeo, AI Ark, Apollo, Leads Finder, Google Maps, Ecommerce Stores)
- [ ] **LEAD-10**: Domain resolution step when working from company name lists (resolve domains first, then people search)

### Copy Quality

- [ ] **COPY-01**: Extended copy-quality.ts — full rule set (word count tiered by strategy, all banned phrases, greeting check, CTA softness, variable format, subject line rules)
- [ ] **COPY-02**: Mandatory self-review gate before save — writer calls validate-copy CLI, auto-rewrites if violations (max 2 retries, then save with review notes)
- [ ] **COPY-03**: Campaign-holistic awareness — writer loads all existing steps (email + LinkedIn) before generating, maintains "taken angles" and "taken CTAs" list
- [ ] **COPY-04**: Intent-based anti-pattern descriptions in rules (not just banned phrases — describe the pattern to avoid)
- [ ] **COPY-05**: LinkedIn-specific validation (no spintax, no paragraph format, under 100 words, chat tone)
- [ ] **COPY-06**: KB consultation must produce applied output (not just "searched KB" — cite specific principle used)
- [ ] **COPY-07**: Validator agent (Opus 4.6 via Claude Code CLI) reviews copy after writer self-review — catches semantic issues (filler spintax, tonal mismatch, angle repetition)

### Campaign Pipeline

- [ ] **PIPE-01**: Channel-aware list building — email campaigns get people with verified emails + LinkedIn URLs; LinkedIn-only campaigns get people with LinkedIn URLs only (skip email enrichment)
- [ ] **PIPE-02**: List overlap detection — flag if any person appears in multiple active campaigns
- [ ] **PIPE-03**: All lead data normalised before campaign usage — company name, location, job title, industry
- [ ] **PIPE-04**: Data quality pre-check before campaign creation (list has usable data for the campaign's channel)
- [ ] **PIPE-05**: Portal approval hard-blocks on copy quality violations (HTTP 422, not just warnings)
- [ ] **PIPE-06**: Cost tracking per pipeline stage (discovery → enrichment → campaign — report total spend)

### Cross-Cutting

- [ ] **CROSS-01**: All agents use Opus 4.6 (best available model) — no cost-optimised model downgrades since Max Plan covers all usage

## v9.0 Requirements (Future)

### Dev Agent Team

- **DEV-01**: Debugger agent — investigates issues using scientific method, manages debug sessions
- **DEV-02**: Feature builder agent — implements features from briefs with code quality standards
- **DEV-03**: Test runner agent — runs tests, validates changes, reports results
- **DEV-04**: Code reviewer agent — reviews PRs and changes for quality, security, performance

## Out of Scope

| Feature | Reason |
|---------|--------|
| New discovery adapters | Existing platforms sufficient — quality of usage is the problem |
| PipelineRun DB model | Over-engineering for v8.0 — cost tracking via logging first |
| BounceBan adapter integration | Deferred to v8.1 — verify workflow works manually first |
| Writer retry UI queue | Failed drafts save with review notes — admin sees in existing approval flow |
| Dev agent team | v9.0 milestone — finish campaign quality first, then build dev agents using same patterns |
| Model cost optimisation | Max Plan covers all usage — always use best available model |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LEAD-01 | Phase 56 | Pending |
| LEAD-02 | Phase 53 | Pending |
| LEAD-03 | Phase 53 | Pending |
| LEAD-04 | Phase 56 | Pending |
| LEAD-05 | Phase 56 | Pending |
| LEAD-06 | Phase 56 | Pending |
| LEAD-07 | Phase 53 | Pending |
| LEAD-08 | Phase 56 | Pending |
| LEAD-09 | Phase 53 | Pending |
| LEAD-10 | Phase 56 | Pending |
| COPY-01 | Phase 52 | Pending |
| COPY-02 | Phase 54 | Pending |
| COPY-03 | Phase 54 | Pending |
| COPY-04 | Phase 54 | Pending |
| COPY-05 | Phase 54 | Pending |
| COPY-06 | Phase 54 | Pending |
| COPY-07 | Phase 55 | Pending |
| PIPE-01 | Phase 57 | Pending |
| PIPE-02 | Phase 57 | Pending |
| PIPE-03 | Phase 57 | Pending |
| PIPE-04 | Phase 57 | Pending |
| PIPE-05 | Phase 57 | Pending |
| PIPE-06 | Phase 57 | Pending |
| CROSS-01 | Phase 52 | Pending |

**Coverage:**
- v8.0 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-03-30*
*Last updated: 2026-03-30 after v8.0 roadmap creation — all 24 requirements mapped*
