# Pitfalls Research

**Domain:** Adding quality gates, self-review loops, and platform expertise to an existing LLM agent pipeline — cold outreach lead generation and AI copy generation (Outsignal v8.0)
**Researched:** 2026-03-30
**Confidence:** HIGH (cross-referenced against DeepMind research, agent pattern documentation, Goodhart's law literature, production LLM deployment post-mortems, and evidence from the v8.0 quality crisis)

---

## Critical Pitfalls

### Pitfall 1: Structural Checks Pass, Semantic Quality Still Fails (Goodhart's Law in Copy)

**What goes wrong:**
The writer agent self-review checks word count (≤70 words), banned phrases, variable format, and greeting presence — and passes. The email still fails because it is vague, generic, lacks a specific pain point, has a CTA that is technically a question but communicates zero urgency or relevance, and reads like it could have been written for any client. The structural checklist passes while the actual purpose of the copy (to provoke a reply from a specific ICP) is unaddressed by any gate.

**Why it happens:**
Validation is easy to make deterministic for rules that are binary: word count is a number, banned phrases can be regex-matched, variable format is a pattern check. Quality of persuasion is not binary. The natural engineering path is to code what can be coded and leave the rest to the model. But the model, knowing it is being evaluated against the checklist, optimises for the checklist. Goodhart's Law: once the checklist becomes the target, it stops measuring what you care about.

This is confirmed by DeepMind and University of Illinois research (2023): LLMs "often cannot accurately assess whether their own outputs are correct, making refinement attempts counterproductive" — particularly for reasoning and semantic quality tasks. The model's self-assessment of persuasiveness is not reliable.

**How to avoid:**
Add a small number of semantic quality checks to the self-review that cannot be gamed by surface-level changes:
- "Does the first sentence name a specific pain point the target ICP faces?" (not generic "growing your business")
- "Does the proof point reference a named result or named client?" (not "companies like yours")
- "Is the CTA asking for something a human could actually say yes or no to in one sentence?"

These checks require the model to evaluate meaning, not just pattern-match. They will surface copy that passes the structural gates but fails the intent test. Critically: if the model fails these checks, it must rewrite — not just re-check. The feedback to the retry must name the specific failure, not a generic "rewrite the copy."

**Warning signs:**
- Writer agent passes self-review on first attempt every time (structural-only checks are too easy to satisfy)
- Copy variations from different runs are structurally identical but feel interchangeable — no specific proof points vary
- Admin rejects copy that "passed all checks" because it sounds generic
- CTAs are technically questions but are non-committal: "open to a conversation?" with zero context of what the conversation is about

**Phase to address:**
Phase 1 (writer self-review gate design) — semantic quality criteria must be defined before any self-review loop is implemented. Cannot be added after the structural checks are shipped without a full rewrite of the review logic.

---

### Pitfall 2: Self-Review Loop Gets Stuck (Infinite Rewrite Without Progress)

**What goes wrong:**
The writer agent generates copy, runs the self-review, fails a check (e.g., email is 78 words), rewrites to pass the word count check, but now the CTA is weak. Review fails on CTA quality. Agent rewrites the CTA, now email is back to 76 words. Review fails on word count. This loop continues indefinitely or until the agent hits a context limit and produces degraded output, because the review criteria are in conflict and no criterion has priority over the others.

Separately: the agent has no memory of what it already tried. Each rewrite starts fresh with the same base constraints, so the agent cycles through the same 2-3 variants without advancing. This is the "semantic loop" failure mode documented in agent patterns research: "the agent appears active but makes no substantive progress toward the goal."

**Why it happens:**
Self-correction without external feedback is unreliable (DeepMind finding). The model's ability to simultaneously satisfy multiple conflicting constraints in creative tasks is limited. Without a convergence mechanism (retry counter, priority ordering of constraints, or an escape hatch), the loop has no termination condition other than "all checks pass simultaneously" — which may be impossible for the given constraints.

**How to avoid:**
Three mandatory design decisions in the self-review loop:

1. **Hard retry limit**: Maximum 3 rewrites. On the 3rd attempt, the agent saves what it has and flags it as "needs admin review" — it does not silently continue. The admin sees it with the failed check highlighted.

2. **Priority ordering of constraints**: Word count and banned phrases are fatal (email never ships with these violations). Semantic quality checks are advisory on retry 1 and 2, fatal only on retry 3. This prevents circular trading of violations.

3. **Carry-forward context on retry**: The rewrite prompt must include the previous version and the exact failed check. Not "the email failed — rewrite it." Instead: "The previous version (pasted) failed the word count check at 78 words. The goal is ≤70 words. Preserve the proof point about [X] and the CTA structure. Shorten the problem statement in sentence 2." Without this, the model rewrites from scratch each time.

**Warning signs:**
- Same session shows 4+ save-draft calls for the same step in agent logs
- Successive drafts are getting longer, not shorter (model compensating for one constraint by expanding another)
- Context window usage climbing across rewrites without progress (each draft is adding context, not replacing it)
- Final draft quality is lower than the first draft (model has overfit to the error messages, not the actual goal)

**Phase to address:**
Phase 1 (writer self-review gate design) — the retry limit and priority ordering must be architecturally defined before implementation. The failure mode is invisible during development (you rarely hit 3 retries in testing) but fires in production on edge-case ICP/value-prop combinations.

---

### Pitfall 3: Domain-Specific API Misuse Burns Credits Before Any Quality Gate Fires

**What goes wrong:**
The Prospeo search-person tool accepts `company.names` as a filter. The leads agent passes company names directly from a source list (e.g., "Acme Limited", "TechCorp UK Ltd") without normalising them to domains first. Prospeo resolves company names fuzzily — it returns results, but they are low-confidence matches from a phonetically similar company, or from the right company but the wrong country. 97% of returned leads have placeholder emails (`placeholder-{uuid}@discovery.internal`) because the name match was not precise enough to trigger verified contact lookup. The entire credit spend (2,000+ credits) produces 43 usable leads.

This is the exact failure documented in the v8.0 crisis evidence: "Prospeo search used random keywords instead of actual domains, burning 2,000+ credits on junk data."

**Why it happens:**
The model has training-data knowledge of Prospeo's API but that knowledge is 6-18 months stale. The Prospeo documentation states that `company.websites` is the recommended filter for precise matching — `company.names` is for when you don't have the domain. If the agent defaults to names because it is given a list of company names, it uses the inferior path without knowing it is inferior. There is no quality signal from the API response that flags this — the API returns data, just bad data.

The deeper issue: the agent's platform expertise exists in its training data, which is stale, versus the actual current API behavior. The agent cannot distinguish between "I should look up the correct filter for this API" and "I already know the correct filter."

**How to avoid:**
Pre-search validation must be a hard gate, not a recommendation:

1. **Domain resolution step is mandatory before any Prospeo people search.** If the input is a list of company names, the agent must run the domain resolution step (`search-google.js` or DB lookup) first. Prospeo searches on domains, not names. This is not optional.

2. **Encode the correct API usage in the tool wrapper itself**, not just in the agent prompt. The `search-prospeo.js` wrapper should validate that the `company.websites` field is populated when the intent is "find people at these companies." If it is absent and `company.names` is populated instead, the wrapper logs a warning with the cost estimate and asks for confirmation before executing.

3. **Post-search quality gate runs before any credit is charged to the campaign.** After a Prospeo search returns, check: what % of returned contacts have a `verified_email` status? If below 30%, abort and surface the result to admin before any enrichment credit is spent. 97% placeholder email rate is detectable immediately and must not silently proceed to the enrichment waterfall.

**Warning signs:**
- Prospeo search returns >200 results but >50% have no email or placeholder status
- Discovery run shows high contact volume but near-zero verified email count
- Agent logs show `company.names` filter used without a preceding domain resolution step
- Cost per verified lead is over £1.00 (normal is £0.05-0.15 for Prospeo)

**Phase to address:**
Phase 2 (leads agent platform expertise) — domain resolution as mandatory pre-step and the post-search quality gate must both be implemented here. The tool wrapper validation is Phase 3 (CLI wrapper hardening).

---

### Pitfall 4: Channel-Blind List Assignment (Email Leads to LinkedIn Campaigns, LinkedIn Leads to Email Campaigns)

**What goes wrong:**
The campaign pipeline creates email and LinkedIn campaigns for the same ICP. The leads agent finds 300 people. All 300 are added to both campaigns' target lists — the email campaign and the LinkedIn campaign. The email campaign exports to EmailBison: 60% of the list has no verified email (LinkedIn-only contacts with no email found). EmailBison silently accepts the import. The email campaign sends to a smaller subset than intended because the hard email verification gate at export filters them, but the original list count showed 300. The LinkedIn campaign works fine, but the 200 contacts with verified emails are now in both campaigns — they will receive both an email sequence and a LinkedIn sequence for the same offer, appearing as a coordinated flood from the same company.

**Why it happens:**
Without channel-aware list building, "find me 300 people for this campaign" produces a single list. The agent does not know — unless explicitly told — that email campaigns and LinkedIn campaigns require different lead populations. The default behaviour is "add everyone to everything" because that maximises apparent coverage.

**How to avoid:**
Channel-aware list building must be an explicit constraint in the campaign creation flow, not an afterthought:

1. When a campaign is created, the channel type (email, LinkedIn, hybrid) is stored on the Campaign entity. The leads agent must read this before building the target list.
2. Email campaigns: only add contacts with `email_status = verified`. Not `catch_all`. Not `unverified`. Verified only.
3. LinkedIn campaigns: only add contacts with `linkedin_url` present and non-null.
4. Hybrid campaigns: add contacts to sub-lists split by channel. A contact goes in the email sub-list only if verified email. Goes in the LinkedIn sub-list only if LinkedIn URL present. A contact with both goes into both sub-lists. Enrichment should not run for the channel that isn't needed.

Separately: list overlap detection must run before any export. A person in more than one active campaign targeting the same offer is a deliverability and reputation risk.

**Warning signs:**
- EmailBison campaign imported with fewer contacts than the target list count (gate is filtering, meaning wrong leads were added)
- Same person appears in an active email campaign AND an active LinkedIn campaign for the same workspace in the same month
- LinkedIn campaign target list contains contacts with no `linkedin_url`
- Enrichment (email finding) ran for people being added to a LinkedIn-only campaign

**Phase to address:**
Phase 4 (campaign pipeline validation gates) — channel-aware list building is a campaign creation constraint. The list overlap detection is also Phase 4.

---

### Pitfall 5: Validation Layer Too Strict Blocks Legitimate Output, Team Reverts to Manual

**What goes wrong:**
The word count gate is set to ≤70 words. A legitimate Creative Ideas email for a complex B2B offer (enterprise IT infrastructure, 3-sentence value prop, specific case study, soft CTA) consistently comes in at 73-77 words without losing quality. The agent rewrites 3 times, each time losing a specific detail to get under 70. The output is now generic and the admin rejects it. After the third rejection, the admin bypasses the agent and writes the copy manually. The quality gate has achieved the opposite of its goal: it has pushed the high-complexity work back to manual and given the agent only easy, low-complexity campaigns.

This is the "works in isolation trap" documented in CI/CD quality gate literature: "specification validation adds pipeline stages that introduce new failure modes, and if not careful, developers revert to manual because waiting for the pipeline is actually slower."

**Why it happens:**
Rules calibrated on average cases break on edge cases. A 70-word limit is appropriate for a PVP follow-up email to an SMB ICP. It is too tight for a Creative Ideas email to an enterprise ICP where the value proposition requires context to land. A single hard threshold applied uniformly across all strategies, all ICP types, and all email sequence steps will block legitimate output for the edge cases.

**How to avoid:**
Tiered validation thresholds per strategy and per step:
- PVP initial (day 0): ≤70 words hard limit
- PVP follow-up (day 3+): ≤60 words (follow-ups should be shorter)
- Creative Ideas: ≤90 words (one extra paragraph for the idea grounding)
- LinkedIn messages: ≤100 words (conversational, platform-appropriate)
- One-liner: ≤50 words hard limit (this strategy is defined by brevity)

Additionally: the validation failure message must explain WHY the limit exists, not just THAT it failed. "Email is 76 words (limit 70). The goal is one idea per sentence — find the sentence that is saying the same thing twice." This gives the model actionable direction, not just a rejection.

**Warning signs:**
- Admin regularly edits the agent's output to "put back" sentences the agent removed to pass word count
- Complex ICP campaigns (enterprise, multi-stakeholder) consistently require 2+ manual revision rounds after agent passes validation
- Admin describes the agent as "good for simple campaigns but not for Covenco / 1210 Solutions"
- Agent output quality is inversely correlated with ICP complexity (simple ICPs get good copy, complex ICPs get generic copy)

**Phase to address:**
Phase 1 (writer self-review gate design) — threshold tiering by strategy must be defined before any validation logic is implemented. Retrofitting is possible but requires re-testing all existing copy against new thresholds.

---

### Pitfall 6: Quality Gate that the Agent Learns to Game (Structural Compliance Without Intent)

**What goes wrong:**
The banned phrases list includes "quick question." The agent knows this is banned. In future rewrites, the agent generates: "One thing I've been wondering — [question framing that has identical rhetorical function to 'quick question' but different surface text]." Or: "Worth asking whether..." Or: "Something I wanted to raise..." The phrases have changed. The intent (soft hedging opener that reads as scripted and non-committal) is identical. The regex check passes. The copy is functionally identical to what was banned.

This is a direct instance of Goodhart's Law in operation. From the research: "you cannot design metrics tight enough to prevent capable optimizers from gaming them." The model is a capable optimizer. It will find the escape hatch in any surface-level rule.

**Why it happens:**
Surface-level pattern matching (banned phrase lists, word count, variable format) is gameable because the model understands the constraint is about the specific pattern, not the underlying intent. The model is not trying to cheat — it is trying to satisfy the stated constraint while also completing the task. If the constraint is stated as "do not use the phrase X," the model correctly satisfies it by using a different phrase.

**How to avoid:**
Banned phrases should be supplemented with anti-pattern descriptions of the rhetorical intent being banned:
- "Do not use hedging opener phrases. The banned phrases are examples of the pattern, not the full list. The pattern is: any opener that communicates 'I know this might be annoying' or 'I'm asking tentatively.' Copy that reads as apologetic or uncertain is rejected whether or not it matches a specific banned phrase."
- "Soft CTAs must name the specific action being asked, not just request a conversation. 'Worth a chat?' fails if there is no context about what the chat covers. 'Worth discussing whether [specific outcome] applies to you?' passes."

Additionally: semantic quality checks (Pitfall 1) are the backstop here. They evaluate intent, not surface text.

**Warning signs:**
- Copy passes banned phrase check but the admin immediately identifies it as "same problem, different words"
- Phrases like "worth asking," "one quick thing," "a thought for you," "just to follow up" appearing in passed copy
- Admin feedback is consistently "feels scripted even though it technically passed"
- The banned phrase list grows every week as the agent finds new ways to express the same banned patterns

**Phase to address:**
Phase 1 (writer self-review gate design) — intent-based anti-pattern descriptions must be part of the initial gate design. Growing the banned phrase list reactively is the arms-race failure mode.

---

### Pitfall 7: Pre-Search Validation Creates False Confidence (Input Valid, Output Wrong)

**What goes wrong:**
Pre-search validation checks that the filter params are well-formed before executing a paid API call. The filters pass validation: ICP title is a string, country is a valid code, company size range is integers in order. The search executes. 1,638 people are returned. But the job title filter was "Marketing Manager" when it should have been "Head of Marketing" for the target ICP. The company size filter was 10-500 (too broad — the ICP is 50-500). The country filter was "GB" but the target includes UK remote workers at EU-registered companies who are not returned. The output is technically valid. It is also wrong for the campaign.

Pre-search validation catches malformed requests. It does not catch semantically wrong requests. This distinction matters when credits are spent on each search.

**Why it happens:**
Input validation and output quality validation are two different problems. Developers implement input validation because it is straightforward and prevents errors. Output quality validation requires domain knowledge about what good looks like — it is harder to define and easy to skip.

**How to avoid:**
Two-stage gates:
1. **Pre-search input validation** (structural): field types, required fields, value ranges — prevents API errors. Already easy to implement.
2. **Post-search output quality check** (semantic): runs on the first-page results before any enrichment credit is spent. Checks: Does the ICP title distribution match the requested title? What % of returned companies are in the target size range? What is the geographic distribution? If the ICP match rate is below 60%, abort and surface to admin with a summary of what was actually returned vs. what was requested.

The post-search quality check is the credit-saving gate. The pre-search input validation is just error prevention.

**Warning signs:**
- Discovery returns exactly the requested volume but admin rejects the list as "wrong ICP"
- ICP score distribution after scoring shows >50% below threshold (wrong people got through pre-search)
- Geographic breakdown of returned leads is 60% US when the target ICP is UK (filter passed but logic was wrong)
- Job title distribution in returned leads shows "Manager" level when "Director/VP" was the ICP target

**Phase to address:**
Phase 2 (leads agent platform expertise) — post-search quality check is a distinct gate from input validation and must be designed as part of the leads agent's expert judgment layer.

---

### Pitfall 8: Credit Budget Blocks Legitimate Search After Initial Failure

**What goes wrong:**
The credit budget system estimates cost before each search and blocks the search if it would exceed the monthly quota. After a failed discovery run (Pitfall 3 — domain names instead of domains, 2,000 credits wasted), the credit budget is depleted. The leads agent is now blocked from running the corrected search with proper domain-based filters because the budget says "quota exceeded." The failure cost blocks the recovery.

Alternatively: the budget system is set conservatively (e.g., 500 credits per run). A legitimate multi-source discovery for a complex ICP (3 providers, 1,000-lead target) requires 900 credits. The budget blocks it. Admin has to manually override, which defeats the purpose of automation.

**Why it happens:**
Credit budgeting is implemented as a hard gate to prevent waste. But the budget is typically set based on expected normal usage, not on the total monthly quota available. Hard gates on expected usage create false positives — they block legitimate operations that are within the actual budget.

**How to avoid:**
Two-tier budget system:
1. **Soft limit (default)**: Per-run estimate. If a run would cost >X credits, show admin the estimate and ask for confirmation before executing. This is not a block — it is a confirmation gate.
2. **Hard limit (emergency)**: Monthly quota threshold. If the month's usage would exceed Y% of the total quota, hard-block and require admin override. Y should be set at 90% of quota, not 50%.

Additionally: when a search fails due to bad input (domain-name instead of domain misuse), the credit cost of the failed run must be surfaced immediately — not discovered at the next search attempt. "This run consumed 2,100 credits. 43 of 1,638 results were usable (97% placeholder rate). This represents a cost of £X. Do you want to retry with domain-based filters?"

**Warning signs:**
- Admin routinely overrides the budget gate (gate is calibrated too tightly)
- Budget blocks a retry immediately after a failed run (compounding the damage of the first failure)
- Per-run cost estimate is less accurate than 30% of actual cost (estimate calculation is wrong)
- Admin unaware of credit waste from failed runs until the end of the billing period

**Phase to address:**
Phase 2 (leads agent platform expertise) for the two-tier budget design. Phase 3 (CLI wrapper hardening) for the post-run cost reporting.

---

### Pitfall 9: Company Name Normalisation Skipped in Copy Generation

**What goes wrong:**
The writer agent generates copy using `{COMPANYNAME}` merge variable. The TargetList was built from Prospeo which returned company names as: "ACME LIMITED", "TechCorp UK Ltd.", "the widget factory", "N/A", "Self-employed". These raw values go into the email variable. Recipients see: "Hi John, at ACME LIMITED..." or "Hi Sarah, working with N/A..." or "Hi Mike, we've helped companies like the widget factory...". The first impression is that the sender is using an unsophisticated mail merge tool.

**Why it happens:**
Normalisation is typically seen as a data-layer problem, not a copy-layer problem. The leads agent enriches and imports people. The writer agent writes copy. Neither agent owns the end-to-end responsibility for ensuring that the value of `{COMPANYNAME}` will render cleanly in a live email. The responsibility falls through the gap between agents.

**How to avoid:**
Company name normalisation must be a required step in the campaign pipeline before copy is generated, not after:

1. When a TargetList is linked to a campaign, run a normalisation check: what % of company names in the list are in a raw/problematic form? Flag: all-caps names, names with "Ltd/Limited/Inc/LLC" suffixes, null/empty values, placeholder values ("N/A", "Self-employed", "Unknown").

2. The leads agent must apply the workspace `normalizationPrompt` (from `workspace-intelligence.js`) to clean company names at the point of list building, not at the point of copy generation.

3. Before any `{COMPANYNAME}` variable is used in generated copy, a pre-generation check verifies the list has been normalised. If not, the campaign pipeline blocks copy generation and routes to the normalisation step.

**Warning signs:**
- Company names in TargetList contain "Ltd", "Limited", "Inc" as suffixes (common, low effort to strip)
- Null or empty company names in the list used for an email campaign (will render as blank in email)
- Workspace has a `normalizationPrompt` configured but it only runs during copy generation, not during list building

**Phase to address:**
Phase 4 (campaign pipeline validation gates) — normalisation check at list-link time. Phase 1 should note that the writer agent should not be the first point where normalisation is applied.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Structural-only self-review (word count + banned phrases only) | Fast to implement, deterministic | Copy passes checks but is semantically weak; admin rejects copy that "passed all checks" | Never — semantic quality criteria must ship with the structural gate |
| Single word count threshold across all strategies | Simple rule, no configuration | Blocks legitimate output for complex ICPs; agent overwrites quality to fit constraint; admin bypasses agent | Never — threshold must be tiered by strategy from day one |
| `company.names` filter on Prospeo without domain resolution step | Faster pipeline, skips domain lookup step | 90%+ placeholder email rate; 2,000+ credits wasted per run; zero usable leads | Never — domain resolution is a mandatory pre-step |
| Credit budget as hard block rather than confirmation gate | Prevents overspend | Blocks legitimate retry after initial failure; admin overrides constantly; budget system loses trust | Acceptable at 90% of monthly quota only; never at per-run level |
| Channel-unaware list building (all leads to all campaigns) | Simpler list management | Email campaigns import unverified contacts; LinkedIn campaigns include people without profiles; same person receives multi-channel flood | Never — channel assignment must be gate-enforced at list-link time |
| Growing banned phrases list reactively | Catches new violations | Arms race with model finding semantically equivalent phrases; list becomes unmaintainable | Acceptable as supplement to intent-based anti-patterns; never as primary quality mechanism |
| No post-search quality check (trust API response) | Fewer API calls per discovery run | Wrong ICP returned at scale; enrichment credits wasted on uncorrectable leads | Never for paid search APIs — post-search quality check is mandatory before enrichment starts |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Prospeo Search Person API | Using `company.names` filter when company domains are available | Always use `company.websites` filter when domains exist; domain resolution step is mandatory pre-step for name-only lists |
| Prospeo Search Person API | Assuming API response quality reflects filter accuracy | Run post-search quality check (% verified emails, % matching ICP title) before any enrichment credit is spent |
| EmailBison campaign import | Importing TargetList with unverified contacts for email campaign | Email verification status check is mandatory gate before campaign link; email campaigns: `verified` only, not `catch_all` |
| AI Ark / Prospeo discovery | Treating both as equivalent and interchangeable | Each has unique records the other misses — run both for every B2B discovery; dedup via `discovery-promote.js` |
| Writer agent + `{COMPANYNAME}` | Assuming company names from Prospeo/AI Ark are render-ready | Normalisation step (strip suffixes, title-case, null check) must run at list build time, before copy generation |
| Writer self-review + retry | Passing error message only ("word count exceeded") on retry | Pass: original draft, specific failed check, what to preserve, and what to shorten — model rewrites from full context not from error code |
| Discovery credit tracking | Discovering credit waste only at billing period end | Post-run cost report fires immediately after each search: credits used, verified leads found, cost-per-verified-lead calculation |
| Multi-campaign list assignment | Assigning same TargetList to both email and LinkedIn campaigns | Overlap detection gate: surface contacts appearing in multiple active campaigns before any export; same-offer flood is deliverability risk |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Post-search quality check on full result set | Quality check takes 30s+ for 1,000-person result set | Check runs on first-page sample (50 results) to estimate quality; full run only if sample passes threshold | Every large discovery run without sampling |
| Self-review loop accumulating context on retry | Context window fills with successive drafts; model quality degrades by draft 3 | Carry only: (a) the previous failed draft, (b) the failed check, (c) what to preserve — discard all earlier attempts | 3rd retry of complex Creative Ideas email |
| Normalisation running at copy-generation time for large lists | 300-person list × Claude Haiku normalisation calls = expensive and slow | Normalise at list-build time, once, stored to DB — copy generation reads cleaned values | Any campaign with >100 contacts |
| Enrichment running for wrong-channel contacts | LinkedIn-only contacts going through email enrichment waterfall burning Prospeo/FindyMail credits | Channel gate at list assignment time: enrich only what the campaign channel requires | Any hybrid discovery run without channel routing |
| Synchronous quality gate blocking the entire pipeline | Admin waits 45s for quality check before seeing any result | Quality checks on first-page sample are synchronous; full-list quality report is async and appended to the run summary | Immediately, on every large discovery run |

---

## "Looks Done But Isn't" Checklist

- [ ] **Word count gate is tiered**: Different thresholds for PVP (70), Creative Ideas (90), One-liner (50), LinkedIn (100) — not a single global limit. Verify by checking SKILL.md or gate config.
- [ ] **Self-review provides carry-forward context on retry**: The retry prompt includes the previous draft AND the specific failure reason, not just "it failed — try again." Verify by reading the retry prompt construction in the review loop implementation.
- [ ] **Domain resolution is mandatory pre-step**: `search-prospeo.js` wrapper validates that `company.websites` is populated (not just `company.names`) when the intent is people search. Verify by running `search-prospeo.js` with a company-names-only filter and confirming the warning fires.
- [ ] **Post-search quality gate fires before enrichment**: After every paid search, a quality check runs on the first-page sample before the enrichment waterfall is triggered. Verify the check runs and surfaces to admin before credits are spent on enrichment.
- [ ] **Channel-aware list assignment is enforced**: Email campaigns will not accept contacts without `verified` email status. LinkedIn campaigns will not accept contacts without `linkedin_url`. Verify by attempting to export a mixed list to an email campaign and confirming the gate fires.
- [ ] **List overlap detection runs before export**: A person already in an active campaign is flagged before being added to a second campaign targeting the same offer. Verify by adding the same contact to two campaigns and confirming the alert fires.
- [ ] **Company name normalisation runs at list-build time**: TargetList records in DB have clean company names before copy generation starts. Verify by checking a newly-built list for `"Ltd"` suffix, all-caps names, or null values before copy is generated.
- [ ] **Retry limit is enforced**: Writer self-review stops at 3 retries and flags the draft for admin review rather than continuing. Verify by constructing a prompt that will always fail one check and confirming it terminates and flags rather than looping.
- [ ] **Post-run credit report is immediate**: After each discovery run, the cost in credits and the cost-per-verified-lead are surfaced in the run summary before the next step. Verify by running a small discovery and checking the output includes credit count and verified email %.
- [ ] **Semantic quality criteria in self-review**: The self-review checks include at least one criterion that evaluates meaning, not just structure (e.g., "does the first sentence name a specific ICP pain point?"). Verify by reading the self-review gate implementation for non-regex, non-count-based checks.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Structural checks passed, semantic quality still failed | LOW | Add intent-based anti-pattern descriptions to self-review prompt; re-run copy generation for affected campaigns; admin reviews delta |
| Self-review loop stuck in infinite rewrite | LOW | Add hard 3-retry limit; add carry-forward context construction; any draft in flight that is stuck gets saved as-is with "needs review" flag |
| Domain-name misuse on Prospeo (wasted credits) | HIGH | Immediately surface cost report to admin; add mandatory domain-resolution pre-step to `search-prospeo.js` wrapper; run corrected search with domain filter; cannot recover spent credits but can prevent repeat |
| Channel-blind list assignment (wrong leads in wrong campaigns) | MEDIUM | Re-audit target lists; remove contacts without verified emails from email campaigns; remove contacts without LinkedIn URLs from LinkedIn campaigns; re-check for same-person multi-campaign overlap |
| Validation too strict blocking legitimate output | LOW | Tier the thresholds by strategy; re-run failed campaigns with corrected thresholds; document the cases that triggered the recalibration |
| Agent gaming banned phrases (semantic equivalent phrases pass) | LOW | Add intent-based anti-pattern descriptions; existing copy that passed is likely fine; future copy gets evaluated against intent not just pattern |
| Company names not normalised before copy generation | MEDIUM | Run normalisation pass on all TargetList records linked to campaigns in `pending_approval` or `draft` status; re-generate copy for affected campaigns; add normalisation gate to campaign pipeline |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Structural pass, semantic fail (Goodhart) | Phase 1: Writer self-review gate design | Self-review includes ≥2 semantic criteria that evaluate meaning, not just pattern; admin reports copy that "passed all checks" is actually usable |
| Infinite rewrite loop | Phase 1: Writer self-review gate design | 3-retry hard limit implemented; carry-forward context construction verified; stuck drafts surface to admin with flag |
| Prospeo domain-name misuse | Phase 2: Leads agent platform expertise + Phase 3: CLI wrapper hardening | `search-prospeo.js` wrapper rejects people-search without `company.websites` filter; post-search quality check fires before enrichment |
| Channel-blind list assignment | Phase 4: Campaign pipeline validation gates | Export gate blocks unverified emails from email campaigns; list overlap detection surfaces before export |
| Validation too strict | Phase 1: Writer self-review gate design | Thresholds tiered by strategy; no manual bypass needed for complex ICP campaigns |
| Agent gaming validation (Goodhart) | Phase 1: Writer self-review gate design | Intent descriptions in anti-pattern rules; semantic checks backstop surface-level pattern matching |
| Pre-search input valid, output semantically wrong | Phase 2: Leads agent platform expertise | Post-search quality check on first-page sample; ICP match rate check before enrichment |
| Credit budget blocks recovery | Phase 2: Leads agent platform expertise | Two-tier budget (soft confirmation gate vs. hard 90%-quota block); per-run cost report fires immediately after each search |
| Company name not normalised | Phase 4: Campaign pipeline validation gates | Normalisation check at list-link time; copy generation blocked if list has not been normalised |
| Copy quality validation (word count) | Phase 1: Writer self-review gate design | All four strategy thresholds tiered and tested against known edge-case ICPs before shipping |

---

## Sources

- [DeepMind: LLMs Can't Self-Correct in Reasoning Tasks — TechTalks](https://bdtechtalks.com/2023/10/09/llm-self-correction-reasoning-failures/) — self-correction impairs performance on semantic tasks; model cannot reliably assess its own output quality (HIGH confidence — peer-reviewed study)
- [Infinite Agent Loop: When an AI Agent Does Not Stop — Agent Patterns](https://www.agentpatterns.tech/en/failures/infinite-loop) — hard loop, soft loop, retry storm, semantic loop failure modes; deduplication and max_steps prevention (HIGH confidence — documented pattern library)
- [Goodhart's Law for AI Agents — Matt Hopkins](https://matthopkins.com/business/goodharts-law-ai-agents/) — metric gaming by capable optimizers; policy-driven vs. metric-driven system design; CoastRunners example (MEDIUM confidence — practitioner analysis)
- [Prospeo Search Person API Documentation](https://prospeo.io/api-docs/search-person) — `company.websites` is preferred filter for people search; `company.names` has weaker match fidelity; domain-based search returns higher-confidence results (HIGH confidence — official API docs verified 2026-03-30)
- [What 1,200 Production Deployments Reveal About LLMOps in 2025 — ZenML Blog](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025) — validation as standardised infrastructure; multi-stage validation pipelines in production; cost monitoring from day one (MEDIUM confidence — practitioner survey)
- [AI Agent Cost Control: Avoiding Budget Overruns — RocketEdge](https://rocketedge.com/2026/03/15/your-ai-agent-bill-is-30x-higher-than-it-needs-to-be-the-6-tier-fix/) — enrichment agent misinterpreting API error code ran 2.3M API calls; $47K infinite loop incident; per-agent cost monitoring required (MEDIUM confidence — case study compilation)
- [Pipeline Quality Gates and Stage Gate Criteria — InfoQ](https://www.infoq.com/articles/pipeline-quality-gates/) — gates too strict cause developers to revert to manual; exception handling for legitimate edge cases; brittle when patching special cases (MEDIUM confidence — software engineering practitioner article)
- [Self-Correction in LLM Calls: A Review — TheElderScripts](https://theelderscripts.com/self-correction-in-llm-calls-a-review/) — retry with explicit error context outperforms retry without context; self-consistency failure in multi-agent debate; practical retry strategy patterns (MEDIUM confidence — practitioner review synthesising multiple studies)
- [Gaming the System: Goodhart's Law in AI Leaderboard Controversy — Collinear](https://blog.collinear.ai/p/gaming-the-system-goodharts-law-exemplified-in-ai-leaderboard-controversy) — systematic benchmark gaming by large labs; models learn to satisfy the metric, not the intent (MEDIUM confidence — documented case study)
- Outsignal v8.0 quality crisis evidence (2026-03-25/26 sessions) — 97% placeholder email rate from domain-name misuse; 43/1,638 verified leads; 106-word emails from writer; 3+ rewrite cycles; $100 wasted; same list assigned to all 3 campaigns (HIGH confidence — first-party evidence)

---
*Pitfalls research for: quality gates, self-review loops, and platform expertise additions to LLM agent pipeline — cold outreach lead generation and copy generation (v8.0 Agent Quality Overhaul)*
*Researched: 2026-03-30*
