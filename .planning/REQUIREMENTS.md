# Requirements: Outsignal Lead Engine v3.0

**Defined:** 2026-03-09
**Core Value:** Close the feedback loop — automatically classify replies, rank campaign performance, benchmark across workspaces, generate AI-powered insights, and present actionable suggestions to the admin. The system does the analysis; the admin makes the decisions.

## v3.0 Requirements

### Reply Classification

- [x] **REPLY-01**: Admin can see every reply stored with full body text, sender, subject, timestamp, and linked campaign
- [x] **REPLY-02**: Each reply is automatically classified by intent (interested, meeting_booked, objection, referral, not_now, unsubscribe, out_of_office, auto_reply, not_relevant)
- [x] **REPLY-03**: Each reply is automatically scored for sentiment (positive, neutral, negative) alongside intent classification
- [x] **REPLY-04**: Objection replies are automatically sub-classified by type (budget, timing, competitor, authority, need, trust)
- [ ] **REPLY-05**: Classification runs automatically on webhook receipt and poll-replies cron with no admin action required
- [x] **REPLY-06**: Admin can view classification breakdown (intent distribution, sentiment distribution) per campaign and per workspace

### Campaign Analytics

- [ ] **ANAL-01**: Campaign performance metrics (sent, opened, replied, bounced, interested) are stored locally via daily snapshot cron
- [ ] **ANAL-02**: Admin can rank and compare campaigns within a workspace by reply rate, open rate, bounce rate, and interested rate
- [ ] **ANAL-03**: Admin can see per-step sequence analytics showing which email step generates the most replies
- [ ] **ANAL-04**: Admin can compare copy strategy effectiveness (creative-ideas vs PVP vs one-liner) with aggregate metrics across campaigns

### Copy Analysis

- [ ] **COPY-01**: Admin can see which subject lines produce the highest open and reply rates across campaigns
- [ ] **COPY-02**: Each outbound email body is automatically analyzed for structural elements (CTA type, problem statement, value proposition, case study, social proof, personalization)
- [ ] **COPY-03**: Admin can see which body elements correlate with higher reply rates globally (e.g., "emails with case studies get 2.1x more replies")
- [ ] **COPY-04**: Admin can filter copy analysis by workspace and vertical to see what works differently per industry (e.g., "case studies get 4x in recruitment but only 0.5x in merchandise")
- [ ] **COPY-05**: Admin can view top-performing email templates with element breakdown showing what made them work

### Cross-Workspace Intelligence

- [ ] **BENCH-01**: Admin can benchmark workspace performance against all other workspaces with industry reference bands
- [ ] **BENCH-02**: Admin can compare performance grouped by vertical, copy strategy, and time period
- [ ] **BENCH-03**: Admin can see ICP score calibration — correlation between ICP scores at send time and actual reply/conversion outcomes
- [ ] **BENCH-04**: Admin can see recommended ICP threshold adjustments based on calibration data with confidence indicators
- [ ] **BENCH-05**: Admin can see signal-to-conversion tracking showing which signal types (funding, hiring, tech adoption) produce the best reply outcomes

### AI Insights

- [ ] **INSIGHT-01**: System generates AI-powered insights weekly per workspace analyzing reply patterns, campaign performance, and cross-workspace comparisons
- [ ] **INSIGHT-02**: Each insight includes observation, supporting evidence (data), suggested action, and confidence level
- [ ] **INSIGHT-03**: Admin can approve, dismiss, or defer (snooze N days) each suggested action via the action queue
- [ ] **INSIGHT-04**: Approved actions execute the suggestion (pause campaign, update ICP threshold, flag for copy review)
- [ ] **INSIGHT-05**: Admin can see objection pattern clusters across campaigns (e.g., "42% mention budget, 28% mention timing")
- [ ] **INSIGHT-06**: Admin receives weekly digest notification (Slack + email) summarizing top insights, best/worst campaigns, and pending action queue items

### Intelligence Hub

- [ ] **HUB-01**: Admin can access a dedicated Intelligence Hub dashboard page showing all intelligence data in one place
- [ ] **HUB-02**: Intelligence Hub displays campaign rankings with sortable metrics table
- [ ] **HUB-03**: Intelligence Hub displays reply classification breakdown charts (intent distribution, sentiment, objection types)
- [ ] **HUB-04**: Intelligence Hub displays cross-workspace benchmarking comparison with reference bands
- [ ] **HUB-05**: Intelligence Hub displays active insights and action queue with approve/dismiss/defer controls
- [ ] **HUB-06**: Intelligence Hub displays ICP calibration visualization showing score vs conversion correlation

## Future Requirements

### Advanced Analytics

- **ADV-01**: Automated campaign pause recommendations when bounce rate exceeds threshold for N consecutive days
- **ADV-02**: Predictive reply rate estimation for new campaigns based on historical patterns
- **ADV-03**: Insight quality scoring based on admin approval/dismiss rates (meta-feedback loop)

## Out of Scope

| Feature | Reason |
|---------|--------|
| ML-trained custom classifier | Not enough data at 6 workspaces / ~200 replies/month. LLM classification is more accurate at low volume. |
| Real-time classification streaming | 5-20 replies/day doesn't justify WebSocket/SSE infrastructure |
| Predictive deal scoring | CRM territory — Outsignal is a lead engine, not a CRM |
| A/B test orchestration | EmailBison handles variant sending. We measure results, not orchestrate tests. |
| Per-lead intelligence timeline | Vanity data that duplicates EmailBison's lead view. Aggregate stats matter more. |
| Automated campaign pausing | Must suggest, never act. Admin action queue is the pattern. |
| Client-facing analytics portal | Intelligence is admin-only. Share via digest when relevant. |
| Custom dashboard builder | One admin user doesn't need drag-and-drop layouts. Fixed, opinionated layout. |
| Email thread reconstruction | Complex and brittle. Store latest reply, link to EmailBison inbox for full threads. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REPLY-01 | Phase 23 | Complete |
| REPLY-02 | Phase 23 | Complete |
| REPLY-03 | Phase 23 | Complete |
| REPLY-04 | Phase 23 | Complete |
| REPLY-05 | Phase 23 | Pending |
| REPLY-06 | Phase 23 | Complete |
| ANAL-01 | Phase 24 | Pending |
| ANAL-02 | Phase 24 | Pending |
| ANAL-03 | Phase 24 | Pending |
| ANAL-04 | Phase 24 | Pending |
| COPY-01 | Phase 25 | Pending |
| COPY-02 | Phase 25 | Pending |
| COPY-03 | Phase 25 | Pending |
| COPY-04 | Phase 25 | Pending |
| COPY-05 | Phase 25 | Pending |
| BENCH-01 | Phase 26 | Pending |
| BENCH-02 | Phase 26 | Pending |
| BENCH-03 | Phase 26 | Pending |
| BENCH-04 | Phase 26 | Pending |
| BENCH-05 | Phase 26 | Pending |
| INSIGHT-01 | Phase 27 | Pending |
| INSIGHT-02 | Phase 27 | Pending |
| INSIGHT-03 | Phase 27 | Pending |
| INSIGHT-04 | Phase 27 | Pending |
| INSIGHT-05 | Phase 27 | Pending |
| INSIGHT-06 | Phase 27 | Pending |
| HUB-01 | Phase 28 | Pending |
| HUB-02 | Phase 28 | Pending |
| HUB-03 | Phase 28 | Pending |
| HUB-04 | Phase 28 | Pending |
| HUB-05 | Phase 28 | Pending |
| HUB-06 | Phase 28 | Pending |

**Coverage:**
- v3.0 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0

---
*Requirements defined: 2026-03-09*
*Last updated: 2026-03-09 after roadmap creation*
