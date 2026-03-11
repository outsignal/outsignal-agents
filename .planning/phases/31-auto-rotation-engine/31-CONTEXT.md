# Phase 31: Auto-Rotation Engine - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Sender health status escalates and recovers automatically based on bounce rate thresholds. When a sender reaches critical, the system removes it from campaigns and replaces it with a healthy sender. Full audit trail records every transition. Admin receives Slack + email notifications on status changes.

</domain>

<decisions>
## Implementation Decisions

### Threshold tuning
- Tighter thresholds than originally spec'd: healthy <2%, elevated 2-3%, warning 3-5%, critical >5%
- Fixed globally — not configurable per workspace
- No grace period before escalation — 4-hour check interval provides natural damping
- Blacklisted domain = instant critical for ALL senders on that domain, regardless of bounce rate

### Recovery logic
- Gradual step-down: critical > warning > elevated > healthy (one level per 24h sustained below threshold)
- 24 hours = 6 consecutive checks below the threshold for the target level before stepping down
- Critical to healthy takes minimum 3 days (3 step-downs x 24h each)
- Manual override available — admin can force any status, recorded in audit trail with 'manual' reason
- Next cron check resumes automatic evaluation after manual override (no locking)
- Blacklist recovery is automatic — once domain-health cron confirms delisting, senders re-enter normal threshold evaluation

### Notification behavior
- Notify on status transitions ONLY — no repeat alerts every 4h for sustained states
- Channels: Slack (ops channel) + admin email — never client-facing
- Elevated/warning notifications include recommended action text but are informational only
- Critical notifications state what the system has already done (auto-pause, campaign removal)
- Recovery notifications inform admin when sender steps down a level

### EmailBison actions (automated)
- **Elevated**: notify only, no automated action
- **Warning (3-5%)**: auto-reduce daily sending limit by 50%. Notification states what was done.
- **Critical (>5% or blacklisted)**: auto-remove sender from all active campaigns + keep EmailBison warmup active. Notification states what was done.
- **Sender replacement**: when a critical sender is removed from a campaign, replace with the healthiest available sender (lowest bounce rate) in the same workspace. If no healthy senders available, notify admin.
- **Recovery**: system auto-restores daily limit when sender steps down from warning. Recovered senders return to the available pool — no need to re-add to specific campaigns (replacement sender stays).
- EmailBison has configurable warmup per inbox via API — use this, don't build custom warmup
- All EmailBison API actions feature-flagged pending researcher confirming exact API endpoints

### Claude's Discretion
- Exact EmailBison API method for pausing (set daily limit to 0 vs deactivate endpoint — researcher determines)
- How to store the "original daily limit" for restoration after recovery
- Audit trail schema design (EmailHealthEvent model fields)
- Bounce monitor cron implementation details (batch processing, timeout handling)

</decisions>

<specifics>
## Specific Ideas

- User wants this to feel like an autonomous system — notifications are informational ("here's what the system did"), not approval requests
- The rotation concept: critical sender gets pulled, healthy sender slots in, recovered sender just becomes available again in the pool
- EmailBison's built-in warmup system should be leveraged — don't reinvent it

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 31-auto-rotation-engine*
*Context gathered: 2026-03-11*
