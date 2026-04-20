# Covenco Instantly Content Refresh — Review Doc

**Date:** 2026-04-15
**Source PDF:** `Covenco Instantly Email Sequence (2).pdf` (authored by David Jerram)
**Scope:** Formatting + mapping only. David's wording preserved verbatim.
**Status:** FINAL SHIP STATE — 54 variant bodies stored as Instantly-UI-typed HTML using `<div>…</div><div><br /></div>` paragraph blocks (matching the browser contenteditable output format), with campaign-level `text_only=true` enabled on all 9 campaigns. Under `text_only=true` Instantly strips the HTML at send time and emits a plain-text/MIME body with preserved paragraph breaks (verified Gmail test, 2026-04-15 on Backup Services). Editor displays correctly. Recipients receive plain text. Campaigns remain in DRAFT (status 0); lead queue (42 leads) untouched. See "Final Ship State" section at the bottom of this doc.

**Push history (2026-04-15):**
1. First push — plain-text bodies with Unix LF (`\n\n`), step-level `text_only=true` on each variant. Instantly editor preview collapsed paragraph breaks visually, so admin asked for HTML.
2. Second push — HTML `<p>` bodies, `text_only=false`. Editor rendered correctly but violated cold-outreach plain-text rule on the wire.
3. Third push — plain-text bodies restored with Unix LF, campaign-level `text_only=true` enabled. Gmail test send showed paragraph breaks collapsed to one block (Instantly normalizes bare LF at send time under text_only).
4. Fourth push — CRLF test on Backup Services Step 1 Variant A only. Initially appeared promising but admin's hand-edit in the UI overwrote the Backup Services bodies with `<div>` HTML, which admin then Gmail-tested and confirmed renders correctly under `text_only=true` (HTML stripped on send → plain-text MIME with preserved paragraph breaks).
5. Fifth push — CRLF propagated to all 53 remaining variants under the earlier plain-text plan. Superseded by push 6.
6. Sixth push (FINAL, current) — `<div>` HTML propagated from the admin-verified Backup Services reference to the other 48 variant slots (8 campaigns × 3 steps × 2 variants). Backup Services bodies left UNTOUCHED (admin hand-edited). All 9 campaigns carry `text_only=true`. Status 0 (DRAFT) across the board. 42 leads untouched. Mobile: prefix on the signoff was stripped in an earlier sub-step (Slough landline, not a mobile) and remains stripped. **Clarified policy:** the "no HTML" rule applies to SENT content only — because `text_only=true` strips HTML before the MIME body is written, storing HTML for editor ergonomics does not breach the rule.

---

## Decisions Applied

Admin decisions resolved on 2026-04-15:

1. **Day 3 subjects — Honour David.** Use his Day 3 A/B subjects from the PDF. Accepts that Day 3 renders as a fresh thread in the inbox (breaks the threading-under-Day-1 rule from `feedback_email_threading_subject.md`). This is the chosen trade-off.
2. **Enterprise IT systems — Skipped.** 10th PDF category is ignored; no campaign change; §4.10 dropped from this doc. The 9 mapped campaigns are the full scope.
3. **Casing — David's exact lowercase verbatim.** No sentence-start capitalisation. No IBM / Power11 / DR / IT normalisation. Every subject ships exactly as David typed it in the PDF (all lowercase, including `ibm`, `power11`, `dr`, `it`). Body copy keeps David's own sentence capitalisation — that's his prose, left untouched. This matches writer-rules.md subject-line rule (subjects all lowercase).

---

## Mapping: PDF Category ↔ Instantly Campaign

| # | PDF category | Instantly campaign name | Instantly campaign ID |
|---|---|---|---|
| 1 | Backup services | Covenco - Backup Services | `578c27a2-717c-4ef2-b6d8-031b07261f4d` |
| 2 | Data resiliency and recovery | Covenco - Data Resiliency and Recovery | `aacbce5d-f5a7-4156-8496-967c4efa5bfd` |
| 3 | IT insights | Covenco - IT Insights | `d5c16e36-f3cf-4aef-af79-af23e302ca6e` |
| 4 | IT infrastructure | Covenco - IT Infrastructure | `2bbb4ff1-eaed-4946-a62e-38d9cc24453e` |
| 5 | Ransomware recovery | Covenco - Ransomware Recovery | `d6dce1e9-bebc-4537-aec7-17cbae52af10` |
| 6 | Managed services | Covenco - Managed Services | `ebb2e715-8505-4944-88aa-fa2f326ce166` |
| 7 | IBM storage and servers | Covenco - IBM Storage and Servers | `b87c8795-4331-41c5-8d24-f888be7214d4` |
| 8 | Discover Covenco | Covenco - Discover Covenco | `f439a04c-e213-4dbd-bf0e-2f2463bf6b75` |
| 9 | Disaster recovery | Covenco - Disaster Recovery | `9ef7b7eb-7e6d-4bfe-9962-e3f132d4e8b8` |

Non-outbound Instantly campaigns excluded: `My Campaign` (test), `Covenco Newsletter`. PDF 10th category "Enterprise IT systems" skipped per decision 2.

Merge tags expected: `{{firstName}}`, `{{companyName}}`.
Spintax preserved verbatim where David used it: `{off-site|immutable|offline}` (Backup Day 1), `{protect|stabilise|strengthen}` (Data Resiliency Day 1). Pushed to Instantly as double-brace `{{...}}` because Instantly's spintax engine requires that syntax — the options themselves are unchanged.

---

## Reformatted Campaign Content

Each block below is paste-ready for Instantly. Subjects show A and B variants, all in David's exact lowercase verbatim. Body blocks preserve David's wording verbatim; paragraph breaks added at natural sentence boundaries only, with greeting line and signoff block.

---

### 4.1 Covenco - Backup Services

**Day 1**

- Subject A: `backup gaps to fix`
- Subject B: `backup risk at scale`

```
Hi {{firstName}},

Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {off-site|immutable|offline} backup services built for secure recovery, not box-ticking.

With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.

Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `backup drift is costly`
- Subject B: `confidence in recovery`

```
Hi {{firstName}},

Backup problems rarely start with failure, they start with silent drift, missed checks and limited confidence when recovery is needed fast.

Covenco runs 326 daily backup jobs and supports planning, monitoring, management and recovery as one service for customers across complex estates. That gives teams more control without more admin.

Open to exploring whether {{companyName}} would benefit from a more hands-on backup approach?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `backup cost vs recovery`
- Subject B: `recovery proof matters`

```
Hi {{firstName}},

When budgets are tight, backup usually gets judged on cost, right until a restore takes too long or data cannot be recovered cleanly.

Covenco combines immutable backup, private cloud recovery and day-to-day oversight in one managed service for leaner internal teams. As a Veeam Platinum provider, we keep things practical.

Would it be unreasonable to ask how confident you feel in recovery today?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.2 Covenco - Data Resiliency and Recovery

**Day 1**

- Subject A: `resilience under pressure`
- Subject B: `data resilience gaps`

```
Hi {{firstName}},

Resilience pressure usually shows up when data growth, cyber risk and recovery expectations keep rising at the same time.

Covenco helps organisations {protect|stabilise|strengthen} critical data with off-site backup, immutability, replication and recovery support across mixed environments. We manage over 4PB of customer data and protect 3,000 servers today.

Worth exploring whether data resilience at {{companyName}} is where leadership expects it to be?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `recoverability is the issue`
- Subject B: `where resilience slips`

```
Hi {{firstName}},

Many firms have backup in place, but still lack confidence around recoverability, testing and what happens when systems fail under pressure.

Covenco supports the full cycle, from planning and monitoring through to recovery and ongoing management. That helps reduce risk without creating more overhead internally or more tooling.

Open to exploring whether {{companyName}} has any resilience gaps that are easy to miss day to day?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `resilience without complexity`
- Subject B: `one partner for resilience`

```
Hi {{firstName}},

Resilience tends to get harder when teams are stretched, infrastructure is mixed, and recovery requirements are rising faster than budgets.

Covenco combines data protection, disaster recovery and infrastructure support under one roof, backed by ISO 27001, 9001 and 14001 certifications. That gives teams one specialist partner instead of several disconnected providers and fragmented support models.

Worth a conversation about whether that model could help {{companyName}}?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.3 Covenco - IT Insights

**Day 1**

- Subject A: `where pressure is building`
- Subject B: `it pressure points`

```
Hi {{firstName}},

Many IT leaders are being pushed to improve resilience, control spend and plan infrastructure changes all at once.

Covenco works across backup, recovery, support and hardware, so we see where those pressures tend to collide. After 35 years in the market, the patterns are usually clear quite quickly.

Worth a short exchange on what seems to be creating the most pressure at {{companyName}}?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `the risk between decisions`
- Subject B: `where gaps really sit`

```
Hi {{firstName}},

One common issue we see is teams treating backup, infrastructure and support as separate decisions, then discovering the real risk sits between them.

Covenco helps connect those areas through data management and IT infrastructure services shaped around operational reality. That tends to surface options earlier and reduce avoidable blind spots.

Open to exploring whether {{companyName}} is seeing the same kind of overlap right now?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `hidden infrastructure risk`
- Subject B: `exposed by complexity`

```
Hi {{firstName}},

The more complex the estate, the easier it is for lead times, support gaps or recovery assumptions to create risk quietly in the background.

Covenco supports customers across the UK, Europe and the USA with specialist infrastructure and data resilience services. Sometimes an outside view helps, especially when priorities are moving quickly.

Would it be unreasonable to compare notes on where {{companyName}} may be exposed?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.4 Covenco - IT Infrastructure

**Day 1**

- Subject A: `infrastructure strain building`
- Subject B: `support and sourcing pressure`

```
Hi {{firstName}},

Infrastructure pressure tends to build when systems are ageing, parts are hard to source and projects are slowed by long lead times.

Covenco supplies and supports enterprise and midrange hardware with global sourcing, rapid shipping and practical engineering input. We stock over 40,000 items across major brands and generations.

Worth exploring whether {{companyName}} is feeling any of that procurement or support pressure now?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `too much time chasing parts`
- Subject B: `infrastructure support strain`

```
Hi {{firstName}},

Many internal teams lose time chasing parts, extending ageing kit and juggling vendors when infrastructure support starts to fray.

Covenco helps simplify that with supply, repair, refurbishment and lifecycle services across server, storage and networking estates. That can reduce downtime and planning headaches quickly, especially where long lead times are already hurting projects.

Open to exploring whether {{companyName}} could use a steadier infrastructure partner?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `keep infrastructure productive`
- Subject B: `room to plan properly`

```
Hi {{firstName}},

Replacing everything is rarely realistic when budgets are tight and critical systems still need to perform.

Covenco helps organisations keep infrastructure productive through same-day shipping, flexible sourcing and specialist support, whether the priority is continuity, speed or cost control. That gives teams more breathing room during difficult planning cycles.

Would it be worth asking where infrastructure strain is starting to show at {{companyName}}?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.5 Covenco - Ransomware Recovery

**Day 1**

- Subject A: `recovery after ransomware`
- Subject B: `is recovery really proven`

```
Hi {{firstName}},

Ransomware risk is not only about prevention, it is about how quickly operations can recover when something gets through.

Covenco provides ransomware recovery support with virtual and physical response, designed to reduce downtime and protect data integrity for affected businesses under pressure. Customers on our service average 48-hour recovery times.

Worth exploring whether recovery readiness at {{companyName}} feels proven or mostly assumed today?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `when incident plans stall`
- Subject B: `recovery under pressure`

```
Hi {{firstName}},

Many firms have incident plans, but recovery can still stall when clean data, infrastructure and hands-on expertise are not lined up properly.

Covenco combines cloud-based recovery with physical infrastructure to support restoration when criminals strike. That helps ease pressure on internal teams at the worst moment and shorten disruption significantly.

Open to exploring whether {{companyName}} would benefit from a stronger ransomware recovery plan?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `the cost after attack`
- Subject B: `ransomware recovery readiness`

```
Hi {{firstName}},

The real cost of ransomware usually comes after the attack, when downtime stretches, legal pressure rises and internal teams are pulled in every direction.

Covenco offers round-the-clock recovery assistance and handled 8 ransomware recoveries in 2024 for contracted customers across multiple environments. We focus on getting businesses operational again, fast.

Would it be unreasonable to ask how {{companyName}} would manage that scenario today?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.6 Covenco - Managed Services

**Day 1**

- Subject A: `too much operational load`
- Subject B: `pressure on daily support`

```
Hi {{firstName}},

Many IT teams are carrying too much operational load across patching, monitoring, uptime checks and issue resolution.

Covenco provides managed monitoring and maintenance services that help spot faults early, protect availability and reduce support strain across critical environments every day, without adding complexity. Our approach is built around practical continuity, not ticket volume.

Worth exploring whether {{companyName}} could use more breathing room across day-to-day operations?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `support costs keep rising`
- Subject B: `managed support for busy teams`

```
Hi {{firstName}},

Support becomes expensive when internal teams are dragged into repeat issues, patching gaps and avoidable outages.

Covenco offers managed services covering fault detection, network monitoring, uptime tracking and performance optimisation, all designed to reduce operational friction across busy estates and mixed systems. We also help cut support costs by up to 20 percent.

Open to exploring whether that would be useful at {{companyName}}?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `depth matters in support`
- Subject B: `more than generic managed services`

```
Hi {{firstName}},

A lot of managed services sound similar until something critical fails and response depth gets tested properly.

Covenco combines monitoring, maintenance, backup and infrastructure expertise under one roof, with 24/7 support and token-based specialist services when needed. That gives teams more flexibility than a generic provider during pressured periods and resource gaps.

Would it be worth asking whether {{companyName}} needs that kind of coverage?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.7 Covenco - IBM Storage and Servers

**Day 1**

- Subject A: `ibm power11 planning`
- Subject B: `power11 and continuity`

```
Hi {{firstName}},

Many IBM teams are now weighing Power11 against the cost and risk of holding older estates together for another cycle.

The challenge is rarely hardware alone, it is continuity, supportability and whether the platform still aligns with resilience and hybrid plans. Covenco helps organisations navigate IBM estate decisions with supply, support and practical lifecycle input.

Worth exploring whether {{companyName}} is reviewing any IBM Power11 decisions currently?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `power11 without disruption`
- Subject B: `ibm refresh timing`

```
Hi {{firstName}},

Power11 is getting attention because continuity expectations have changed, especially where maintenance windows, cyber resilience and operational overhead are under scrutiny.

For many teams, the real issue is how to modernise IBM estates without forcing disruption or rushed change. Covenco supports IBM environments with sourcing, maintenance and infrastructure guidance across live estates.

Open to exploring whether {{companyName}} is under any pressure around IBM refresh timing?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `is power11 on radar`
- Subject B: `ibm estate next steps`

```
Hi {{firstName}},

If IBM systems still support critical workloads, delaying estate decisions can quietly increase support pressure, recovery risk and commercial drag.

Power11 has changed the conversation for teams looking at availability, hybrid flexibility and longer-term platform fit. Covenco helps organisations assess the practical route forward across IBM environments, from ongoing support through to newer platform options.

Would it be unreasonable to ask whether IBM Power11 is on {{companyName}}'s roadmap?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.8 Covenco - Discover Covenco

**Day 1**

- Subject A: `where gaps start showing`
- Subject B: `backup recovery infrastructure`

```
Hi {{firstName}},

Many organisations reach a point where backup, recovery and infrastructure support are handled separately, and the gaps start showing.

Covenco brings those areas together through data management, IT infrastructure supply and managed services designed around resilience and continuity across critical estates. We have supported customers since 1989 and hold ISO 27001, 9001 and 14001 certifications.

Worth exploring whether that model could help {{companyName}}?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `when support feels fragmented`
- Subject B: `where covenco tends to help`

```
Hi {{firstName}},

Covenco tends to be useful when teams are dealing with ageing infrastructure, rising recovery expectations or support that feels too fragmented.

We combine backup, disaster recovery, hardware supply and maintenance under one roof, with more than 35 years behind us. That usually means less complexity for customers and fewer handoffs internally.

Open to exploring whether {{companyName}} is facing any of those pressures now?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `continuity meets resilience`
- Subject B: `what covenco focuses on`

```
Hi {{firstName}},

Rather than another broad IT supplier, Covenco focuses on the point where infrastructure continuity and data resilience meet.

We manage over 4PB of customer data, protect 3,000 servers and support customers across the UK, Europe and the USA. That gives us a very practical lens on operational risk and recovery pressure.

Would it be worth asking if any of that is relevant to {{companyName}}?

Kind regards,
David Jerram
+44 1753 478313
```

---

### 4.9 Covenco - Disaster Recovery

**Day 1**

- Subject A: `is dr really proven`
- Subject B: `disaster recovery pressure`

```
Hi {{firstName}},

Disaster recovery often looks fine until the business asks how fast critical workloads can actually come back online.

Covenco delivers local backup, off-site replication, immutability and full disaster recovery services designed to reduce downtime properly. We completed 99 data recoveries in 2024 with a 100 percent success rate overall across customer environments.

Worth exploring whether DR confidence at {{companyName}} is proven or assumed?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 3**

- Subject A: `dr testing gets hard`
- Subject B: `a more testable dr model`

```
Hi {{firstName}},

One common DR issue is that testing becomes difficult, infrequent and too dependent on stretched internal teams.

Covenco includes regular DR testing within its service, making it simpler to validate application recovery without excessive complexity for technical teams and operational stakeholders today. That gives teams clearer evidence and less guesswork.

Open to exploring whether {{companyName}} would benefit from a more testable recovery model?

Kind regards,
David Jerram
+44 1753 478313
```

**Day 7**

- Subject A: `backup alone is not dr`
- Subject B: `recovery after serious outage`

```
Hi {{firstName}},

Maintaining a secondary data centre is expensive, but relying on backup alone can leave recovery objectives exposed.

Covenco offers secure cloud disaster recovery, immutable backups and the ability to restore data onto rental hardware when needed. That creates a more practical path for many teams under pressure and tighter budgets.

Would it be unreasonable to ask how {{companyName}} would recover after a serious outage?

Kind regards,
David Jerram
+44 1753 478313
```

---

## Constraints Honoured

- Campaigns remain in DRAFT (status 0). No sending triggered. No lead queue disturbed (42 leads queued across the 9 campaigns left untouched).
- Campaign-level `text_only=true` set on all 9 campaigns (UI toggle "Send emails as text only"). Bodies stored as Instantly-UI-typed HTML using `<div>…</div><div><br /></div>` paragraph blocks with NBSP (U+00A0) as the trailing inner-div space, matching the admin-verified Backup Services reference. No `<p>`, no `<span>`, no inline styles.
- No campaign create/duplicate. No touch of EmailBison deploy surface.
- No links, no images (David's copy is clean on both rules).
- Greeting `Hi {{firstName}},` on every email (all 27 emails).
- Signoff block `Kind regards, / David Jerram / +44 1753 478313` on every email.
- Subjects pushed verbatim from David's PDF — all lowercase, including `ibm`, `power11`, `dr`, `it`.
- Spintax preserved: `{off-site|immutable|offline}` (Backup Day 1), `{protect|stabilise|strengthen}` (Data Resiliency Day 1). Rendered in Instantly as `{{option1|option2|option3}}` (double-brace syntax required by Instantly's spin engine; the option content is unchanged).
- Merge tags `{{firstName}}`, `{{companyName}}` preserved exactly.
- Hyphens preserved ("off-site", "same-day", "24/7", "business-critical", "hands-on", "day-to-day", "round-the-clock", "48-hour", "longer-term", "cloud-based", "token-based").
- Variant B body is identical to Variant A body per existing Instantly pattern — only subjects differ for A/B testing.
- Day 3 subjects are fresh (not empty) per decision 1; accepted threading break trade-off.

---

## Final Ship State (2026-04-15, iteration 6)

**Format locked:** Instantly-UI-typed `<div>` HTML + campaign-level `text_only=true`. This is the authoritative ship format for all Covenco Instantly cold-email campaigns.

**Why this format:** Admin hand-edited Backup Services bodies in the Instantly browser editor. The editor's contenteditable surface produces `<div>…</div><div><br /></div>` paragraph blocks with NBSP (U+00A0) as the trailing inner-div space. Admin's Gmail test send (2026-04-15) confirmed that under `text_only=true` Instantly strips these tags at send time and emits a plain-text/MIME body with paragraph breaks preserved — the recipient receives plain text, the editor renders cleanly, and the cold-outreach plain-text rule is honoured on the wire. Prior iterations (plain-text LF, plain-text CRLF, HTML `<p>`) were superseded by this format because it is what the admin's editor actually produces and what he has UAT-verified.

**Final canonical body shape (apply to every variant; `·` = NBSP U+00A0):**

```
<div>Hi {{firstName}},·</div><div><br /></div><div>{paragraph 1}·</div><div><br /></div><div>{paragraph 2}·</div><div><br /></div><div>{CTA paragraph}·</div><div><br /></div><div>Kind regards,·</div><div>David Jerram·</div><div>+44 1753 478313</div>
```

Terminating `+44 1753 478313` is in its own `<div>` with NO trailing NBSP. The three signoff lines (`Kind regards,`, `David Jerram`, `+44 1753 478313`) sit in consecutive `<div>`s with NO empty `<div><br /></div>` between them, so they render as one visual block.

**Policy clarification (admin-confirmed 2026-04-15):** the "no HTML in cold outreach" rule applies to SENT content, not STORED content. With `text_only=true` Instantly converts stored HTML to a plain-text MIME body before dispatch, so storing `<div>` HTML for editor ergonomics does not breach the rule.

**Verified stored state (2026-04-15, iteration 6):**
- 54/54 variant bodies stored as Instantly-UI-typed `<div>` HTML; 11 `<div>` opens and 4 `<br />` per variant.
- 54/54 bodies start with `<div>Hi {{firstName}},·</div>` and end with `<div>+44 1753 478313</div>` (no `Mobile:` prefix anywhere).
- 54/54 contain `{{firstName}}`. `{{companyName}}` present wherever David's source copy references it — Backup Services Day 7 (Step 3) intentionally omits `{{companyName}}` in its CTA ("how confident you feel in recovery today?"), consistent with §4.1 Day 7 above.
- Spintax preserved verbatim: `{{off-site|immutable|offline}}` on Backup Services Step 1 (both variants), `{{protect|stabilise|strengthen}}` on Data Resiliency and Recovery Step 1 (both variants).
- 9/9 campaigns `text_only=true`.
- 9/9 campaigns `status=0` (DRAFT).
- 42/42 leads queued (distribution unchanged: Backup Services 4, Data Resiliency 2, IT Insights 0, IT Infrastructure 2, Ransomware 0, Managed Services 0, IBM 32, Discover 0, Disaster Recovery 2).
- Subjects match David's PDF verbatim (all lowercase); not rewritten in this iteration.

**Propagation script:** `scripts/maintenance/_covenco_iter6_div_propagate.ts` — single-run propagate + audit; refuses to touch non-DRAFT campaigns; skips Backup Services body writes (reference admin-hand-edited); idempotent.
