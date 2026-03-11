---
gsd_state_version: 1.0
milestone: v5.0
milestone_name: Client Portal Inbox
status: defining_requirements
last_updated: "2026-03-11T12:00:00.000Z"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
parallel_milestones:
  - milestone: v4.0
    milestone_name: Email Deliverability & Domain Infrastructure Monitoring
    status: in_progress
    current_phase: 30
    total_phases: 32
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-11)

**Core value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.
**Current focus:** v5.0 Client Portal Inbox (defining requirements) | v4.0 Email Deliverability (phase 30, parallel agent)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-03-11 — Milestone v5.0 started (parallel with v4.0)

Progress: v5.0 [░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 108 (v1.0: 22, v1.1: 40, v2.0: 26, v3.0: 16, v4.0: 4)
- Average duration: ~15 min
- Total execution time: ~22 hours

**Recent Trend:**
- v3.0 phases shipped in 1 day (2026-03-10)
- Trend: Stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

- [v4.0 Pre-Milestone]: EmailBison API to be investigated for sender management endpoints before Phase 2
- [v4.0 Pre-Milestone]: $0 budget — all monitoring via DNS lookups + existing EmailBison data, no paid external APIs
- [v4.0 Pre-Milestone]: mail-tester.com for on-demand placement testing (~1-2 euros/pack, semi-automated)
- [v4.0 Pre-Milestone]: cron-job.org free tier has no hard job count limit (fair usage policy)
- [v4.0 Pre-Milestone]: Targeted blacklist checking — only domains with >3% bounce rate or not checked in 7+ days
- [v4.0 Roadmap]: ROTATE-06 EmailBison sender management feature-flagged — API capabilities unknown, investigate first
- [29-01]: Use Node.js dns/promises Resolver (5s timeout) — zero external DNS dependencies
- [29-01]: DomainHealth.domain is unique (not per-workspace) — domain health is global
- [29-01]: DKIM "partial" status for 1-3 of 4 selectors — real mail providers often use only one selector
- [29-01]: computeOverallHealth is a pure function separate from DNS IO — enables testing and reuse
- [29-02]: Cron endpoint at /api/cron/bounce-snapshots (not snapshot-metrics — that path exists for campaign analytics)
- [29-02]: bounceRate uses daily delta when available; falls back to cumulative on first snapshot
- [29-02]: Warmup API (dedi.emailbison.com) fetched alongside snapshots — graceful degradation if unavailable
- [29-03]: DNSBL_LIST splits into 3 critical (Spamhaus ZEN, Barracuda, Spamhaus DBL) and 17 warning entries
- [29-03]: Blacklist checking conditional — only for domains with >3% bounce rate OR not checked in 7+ days
- [29-03]: DNS failure notification fires on every failed check run (not deduplicated) — persistent flag after 48h escalates to critical
- [29-03]: firstFailingSince uses updatedAt from DomainHealth record as proxy for when DNS started failing
- [30-01]: PlacementTest and EmailSenderHealth use email-based soft links (no FK to Sender) — consistent with BounceSnapshot pattern
- [30-01]: pollForResults uses setTimeout loop (not setInterval) — Vercel-safe, no overlapping calls
- [30-01]: Recommended-for-testing uses JS deduplication of BounceSnapshot rows (not raw SQL GROUP BY) — correct for ~100 senders
- [30-02]: notifyPlacementResult suppresses good scores (>=7) — only warning + critical trigger alerts
- [30-02]: POST returns 202 (not 500) when results still pending after 60s polling — caller re-fetches via GET ?refetch=true
- [30-02]: testId extracted from testAddress string for re-fetch in GET handler (only testAddress is persisted)
- [30-02]: dedi.emailbison.com used for test send — dedicated IPs reflect real campaign reputation

### Blockers/Concerns

- EmailBison client has no PATCH/PUT for sender emails — auto-rotation may be advisory-only until API investigation
- Vercel 60s function timeout — DNS blacklist checks for 50+ DNSBLs across multiple domains must use parallel queries + progressive checking
- Vercel Hobby 2-cron limit already used — 4-hour bounce monitor cron (ROTATE-01) may need cron-job.org
- DKIM selector discovery resolved: using google, default, selector1, selector2 (covers Gmail + Outlook)

### Pending Todos

None.

## Session Continuity

Last session: 2026-03-11
Stopped at: Completed 30-02-PLAN.md (POST + GET /api/placement-tests endpoints, sendTestEmail, notifyPlacementResult)
Resume file: None
