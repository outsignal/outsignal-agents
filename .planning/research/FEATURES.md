# Feature Research

**Domain:** Lead enrichment pipeline / Clay replacement for cold outbound
**Researched:** 2026-02-26
**Confidence:** MEDIUM — No live web access; based on domain expertise, Clay prompts library, cold email framework, project context, and competitor knowledge current to training data (Aug 2025). Flagged claims include LOW confidence notes.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that users assume exist. Missing these = product feels incomplete or unusable for cold outbound.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Email finding** (domain → email) | Every enrichment tool does this; without it you can't contact anyone | MEDIUM | Prospeo API covers this; waterfall fallback to FindyMail / AI Ark |
| **Email verification / bounce check** | Industry standard; sending to bad emails kills deliverability | LOW | LeadMagic handles; simple pass/fail flag on Person record |
| **Person enrichment** (name, title, company, LinkedIn) | Clay's core value prop; users expect basic contact data hydration | MEDIUM | AI Ark + Prospeo cover; store in Person.enrichmentData JSON |
| **Company enrichment** (industry, headcount, revenue, domain) | Required for ICP filtering; without it you can't qualify | MEDIUM | AI Ark + Company model already has this foundation |
| **Deduplication before enrichment** | Paying twice for the same lead is a cardinal sin in lead ops | LOW | Query by email before hitting any API; already designed in PROJECT.md |
| **Search and filter UI** | Users need to find leads; no UI = the DB is invisible | HIGH | Filter by name, company, vertical, status, enrichment quality, score |
| **Lead status tracking** | Know what happened to each person (new, enriched, verified, emailed, replied) | LOW | PersonWorkspace already has status field; extend states |
| **List creation** | Group leads into named lists for campaigns | MEDIUM | Core to the export-to-EmailBison workflow |
| **Export to campaign tool** | The output of enrichment is always a list pushed to a sender | MEDIUM | EmailBison is the target; format as CSV or direct API push |
| **Data stored per-workspace** | Multi-tenant tools always scope lead data to each client | LOW | PersonWorkspace junction already handles this |
| **Enrichment status indicators** | Users need to know what's been enriched vs what's missing | LOW | Flag on Person: enriched/partial/missing per data type |
| **AI-powered field normalization** | Clay's most-used feature; standardize industry, company name, seniority | MEDIUM | Claude replaces Clay AI; normalize on ingest |
| **Company-to-person linkage** | Enrichment operates at both levels; must navigate between them | LOW | Already modeled via Person.companyDomain ↔ Company.domain |

### Differentiators (Competitive Advantage)

Features that set this product apart. Not expected from a generic enrichment tool, but directly valuable for the specific cold outbound use case.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **ICP fit qualification via web scraping** | Most enrichment tools return data; this tool judges fit. Firecrawl + Haiku crawls the prospect's site and classifies whether they match the ICP. Clay does this but it's expensive and awkward. | HIGH | Firecrawl already integrated; needs Haiku classification prompt per client |
| **Signal-based lead scoring (1–10)** | Cold email framework defines 3 signal layers (Company Fundamentals, Decision-Maker Readiness, Timing Triggers). Score = signal overlap count. Scores guide prioritization, not just filtering. | HIGH | Custom scoring logic per client's ICP; must be configurable |
| **Waterfall enrichment strategy** | Cheapest API first, only escalate to expensive sources on miss. Apollo/Prospeo → AI Ark → Firecrawl. Saves meaningful money vs Clay's credit-per-action model. | MEDIUM | Provider-agnostic enrichment layer; pluggable new providers without restructure |
| **Dedup-first architecture** | Industry tools don't prevent you from paying for the same lead twice. This is the central value: own the data once, enrich once, reuse everywhere. | LOW | Already in design; enforce DB check before every external API call |
| **Vertical-aware enrichment** | Each client has a different ICP. Normalization and scoring rules can be tuned per client vertical (Branded Merchandise vs Recruitment vs Architecture) | MEDIUM | Vertical stored on Company; scoring prompt can be context-injected |
| **Integrated copy agent** | Writer Agent can generate personalized email sequences directly from enriched lead data. Most enrichment tools stop at the data; this closes the loop to the message. | HIGH | Already built (Writer Agent); needs lead data context injection |
| **Per-client list isolation** | Client workspaces should never see each other's leads. Lists belong to a workspace, not to the platform. | LOW | PersonWorkspace already handles; lists need workspace FK |
| **Enrichment cost transparency** | Show per-lead API cost, total enrichment spend per list/batch. Build awareness of cost into the UI so users don't blindly burn credits. | MEDIUM | Requires logging API calls with cost; surface in UI |
| **Signal-based segmentation** | Build lists not just by firmographic filters but by signal stacking: "companies actively hiring + CEO tenure < 3 years + recently funded." Clay does this manually in tables. | HIGH | Requires rich enough signal data on Person/Company + filter logic |
| **Audit trail on enrichment runs** | Know exactly what enriched what and when, with what sources. Useful for debugging data quality and understanding coverage. | LOW | AgentRun model already exists; extend for enrichment runs |

### Anti-Features (Deliberately Not Build)

Features that seem useful but create scope creep, complexity, or distraction from the core mission.

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Real-time intent signals** (RB2B, Warmly, Vector, Trigify) | High signal quality — website visitors, LinkedIn activity | Requires separate infrastructure, significant cost, complex real-time processing. Not replaceable with simple APIs. Out of scope per PROJECT.md. | Mark as future milestone; design data model to accept intent signals as an additional enrichment field later |
| **LinkedIn automation / scraping** | LinkedIn profiles are gold for enrichment | ToS violation risk, account bans, compliance nightmare. HeyReach handles this separately and intentionally. | Use AI Ark which provides LinkedIn-derived data through compliant means |
| **Full CRM (HubSpot replacement)** | Tempting to centralize all contact history | This is a lead enrichment + list building tool, not a CRM. CRM adds deal stages, activity logging, pipeline management — a different product. EmailBison is the system of record. | Integrate with CRM via export/CSV; don't build CRM features |
| **Email campaign sending** | Users naturally want to send from the same tool they build lists in | EmailBison already does this. Duplicating sending infrastructure (domain management, deliverability, warm-up) is massive scope and a separate business. | One-click push to EmailBison campaign |
| **Bulk data marketplace purchases** | "Buy 50,000 leads" feature | Destroys data quality, creates compliance risk (GDPR/CAN-SPAM), inflates DB with junk | Targeted search + enrichment of small, high-signal lists (3,000–7,500 per campaign per framework) |
| **Real-time collaborative editing** | Multiple users editing the same list simultaneously | Low value for the current 6-client scale; adds websocket complexity | Optimistic locking or simple last-write-wins is sufficient at this scale |
| **Native LinkedIn outreach** | LinkedIn has high reply rates | Separate compliance regime, separate tools (HeyReach), separate infrastructure. Blending cold email and LinkedIn in one tool creates confusion. | Keep LinkedIn in HeyReach; export lists to both tools from this one |
| **AI-generated enrichment hallucination** | "Fill in missing fields with AI" sounds smart | AI making up company headcount or revenue creates bad data that propagates through campaigns, causing embarrassing personalization failures | Only populate fields from verified API sources; use AI only for normalization and classification of real data, never generation of facts |

---

## Feature Dependencies

```
[Email Finding]
    └──requires──> [Email Verification]
                       └──enables──> [Export to EmailBison]

[Company Enrichment]
    └──enables──> [ICP Fit Qualification]
    └──enables──> [Signal-Based Scoring]
    └──enables──> [Vertical-Aware Normalization]

[Person Enrichment]
    └──enables──> [Lead Scoring]
    └──enables──> [Signal-Based Segmentation]
    └──enables──> [Copy Agent Integration]

[Dedup Check]
    └──must precede──> [Email Finding]
    └──must precede──> [Person Enrichment]
    └──must precede──> [Company Enrichment]

[Lead Scoring]
    └──requires──> [Person Enrichment]
    └──requires──> [Company Enrichment]
    └──enhances──> [Signal-Based Segmentation]

[ICP Fit Qualification (Firecrawl + Haiku)]
    └──requires──> [Company Enrichment] (need domain to crawl)
    └──enhances──> [Lead Scoring]

[List Building]
    └──requires──> [Search and Filter UI]
    └──requires──> [Lead Status Tracking]

[Export to EmailBison]
    └──requires──> [List Building]
    └──requires──> [Email Verification]

[Copy Agent Integration]
    └──requires──> [Person Enrichment] (needs name, title, company, signals)
    └──enhances──> [Export to EmailBison] (personalized sequences)

[Signal-Based Segmentation]
    └──requires──> [Company Enrichment]
    └──requires──> [Person Enrichment]
    └──requires──> [Lead Scoring]

[Enrichment Cost Transparency]
    └──requires──> [Waterfall Enrichment Strategy] (need to log which API was called)
```

### Dependency Notes

- **Dedup must be first in every enrichment flow.** All other enrichment features depend on first checking the local DB. This is the central cost-saving mechanism.
- **Email verification gates export.** Don't push unverified emails to EmailBison — it destroys deliverability. Verification is a hard prerequisite for export.
- **Scoring requires both person and company enrichment.** You can't evaluate signal overlap on a half-enriched lead. Score only when enrichment is complete enough.
- **ICP qualification is expensive** (Firecrawl credits + Haiku inference) so it should only run after basic enrichment confirms the lead is worth qualifying.
- **Copy Agent is a consumer of enrichment, not a dependency of it.** It can be built independently but becomes useful only after the enrichment pipeline produces rich data.

---

## MVP Definition

### Launch With (v1 — "Cancel Clay")

Minimum set to replace Clay's actual usage and cancel the $300+/mo subscription.

- [ ] **Dedup-first enrichment check** — Query local DB before any API call. The single most important cost control.
- [ ] **Email finding pipeline** — Prospeo primary, FindyMail/AI Ark fallback. Waterfall strategy with fallback logic.
- [ ] **Email verification** — LeadMagic verify call; flag valid/invalid/risky on Person record.
- [ ] **Person enrichment** — Name, title, company, LinkedIn URL from AI Ark / Prospeo. Store in enrichmentData JSON.
- [ ] **Company enrichment** — Industry, headcount, revenue estimate, description from AI Ark. Store on Company model.
- [ ] **AI normalization** — Industry classification, company name cleanup, seniority standardization via Claude (replaces Clay AI).
- [ ] **Lead scoring** — 1–10 signal overlap score using cold email framework's 3-layer signal model. Configurable per client.
- [ ] **Search and filter UI** — Browse people/companies by name, company, vertical, enrichment status, score. Pagination.
- [ ] **List building** — Create named lists, add/remove leads, filter-to-list workflow.
- [ ] **Export to EmailBison** — Push a list directly to an EmailBison campaign as leads.

### Add After Validation (v1.x)

- [ ] **ICP fit qualification (Firecrawl + Haiku)** — Add once basic enrichment pipeline is proven; higher cost per lead so validate ROI first.
- [ ] **Signal-based segmentation** — Complex filter logic requiring signal data to be reliably populated first.
- [ ] **Enrichment cost transparency** — Surface per-lead costs once pipeline is running; less urgent than the pipeline itself.
- [ ] **Vertical-aware scoring tuning** — Per-client scoring rule customization; start with shared scoring logic, tune after seeing results.

### Future Consideration (v2+)

- [ ] **Real-time intent signals** — RB2B, Warmly, etc. Separate milestone per PROJECT.md.
- [ ] **Copy Agent ↔ enrichment data integration** — Automatic sequence generation from enriched leads. Writer Agent exists but needs enrichment context pipeline.
- [ ] **Bulk enrichment triggers** — Schedule enrichment runs on lists automatically (nightly refresh, new leads batch).
- [ ] **LinkedIn profile-sourced enrichment** — Via compliant data providers only; defer until pipeline is stable.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Dedup check before enrichment | HIGH | LOW | P1 |
| Email finding (Prospeo waterfall) | HIGH | MEDIUM | P1 |
| Email verification (LeadMagic) | HIGH | LOW | P1 |
| Person enrichment (AI Ark) | HIGH | MEDIUM | P1 |
| Company enrichment (AI Ark) | HIGH | MEDIUM | P1 |
| AI normalization (Claude) | HIGH | MEDIUM | P1 |
| Lead scoring (1–10 signals) | HIGH | MEDIUM | P1 |
| Search and filter UI | HIGH | HIGH | P1 |
| List building | HIGH | MEDIUM | P1 |
| Export to EmailBison | HIGH | MEDIUM | P1 |
| ICP fit qualification (Firecrawl + Haiku) | HIGH | HIGH | P2 |
| Signal-based segmentation | HIGH | HIGH | P2 |
| Enrichment cost transparency | MEDIUM | MEDIUM | P2 |
| Vertical-aware scoring tuning | MEDIUM | MEDIUM | P2 |
| Copy Agent ↔ enrichment integration | HIGH | HIGH | P3 |
| Real-time intent signals | HIGH | HIGH | P3 |
| Bulk enrichment scheduling | MEDIUM | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (cancels Clay)
- P2: Should have, add when pipeline is proven
- P3: Future milestone

---

## Competitor Feature Analysis

Based on domain knowledge of Clay, Prospeo, LeadMagic, AI Ark, Apollo, and the project's own validated use case.

| Feature | Clay ($300+/mo) | Prospeo + AI Ark + LeadMagic (unbundled) | Our Approach |
|---------|-----------------|------------------------------------------|--------------|
| Email finding | Built-in (credit-based) | Prospeo (subscription/API) | Prospeo primary, waterfall fallback |
| Email verification | Built-in | LeadMagic (API) | LeadMagic, flag on Person record |
| Person enrichment | Built-in 100+ sources | AI Ark (API) | AI Ark, store in enrichmentData JSON |
| Company enrichment | Built-in | AI Ark (API) | AI Ark, extend Company model |
| Deduplication | Manual; you get charged per run | None built-in | First-class: DB check before every external call |
| AI field normalization | "Claygent" prompts (extra credits) | Not included | Claude; free relative to existing Anthropic spend |
| ICP qualification | Manual Claygent workflow | None built-in | Firecrawl + Haiku; automated classification |
| Lead scoring | Manual columns | None built-in | Custom 1–10 signal scoring per cold email framework |
| Search/filter UI | Spreadsheet-like table | No UI | Next.js UI built for our domain |
| List building | Manual in Clay table | None | Native feature; filter → save as list |
| Export to campaigns | Clay → Instantly / Apollo | Manual CSV | Direct API push to EmailBison |
| Multi-client isolation | No workspace concept | N/A | PersonWorkspace junction per client |
| Pricing model | Per credit (unpredictable) | Per API call (predictable) | Fixed API subscription costs; credits owned, not rented |

**Key insight (MEDIUM confidence, from project context and LinkedIn validation referenced in PROJECT.md):** A lead gen agency replaced Clay with Prospeo + AI Ark for list building, Firecrawl + Haiku for qualification, TryKitt/Icypeas/LeadMagic for email, Supabase as master DB, push to EmailBison. This validates that the unbundled stack can fully replace Clay's functionality at lower cost with better data control.

---

## Sources

- `/Users/jjay/programs/outsignal-agents/.planning/PROJECT.md` — Active milestone scope, key decisions, constraints (HIGH confidence — project's own spec)
- `/tmp/cold-email-engine-framework.md` — Signal layer model, 4-tier lead qualification, list building strategy (HIGH confidence — operational framework already in use)
- `/tmp/clay_prompts.md` — Clay's 102 Claygent prompt categories: Sales Intelligence, Competitive Intelligence, Behavioral/Intent, Technographic, Personalization Intelligence, Executive Intelligence, Market Intelligence, ROI/Value Drivers (HIGH confidence — Clay's own product)
- `/Users/jjay/programs/outsignal-agents/.planning/codebase/INTEGRATIONS.md` — Current API integrations: Prospeo, LeadMagic, AI Ark referenced in STATE.md; Firecrawl already integrated (HIGH confidence — codebase audit)
- `/Users/jjay/programs/outsignal-agents/.planning/STATE.md` — External APIs confirmed: Prospeo, LeadMagic, FindyMail, AI Ark, SerperDev (HIGH confidence — project state)
- Training data knowledge of Clay, Apollo, Prospeo, LeadMagic, AI Ark feature sets (MEDIUM confidence — may be 6–18 months stale; core features are stable)

---
*Feature research for: Lead enrichment pipeline / Clay replacement*
*Researched: 2026-02-26*
