# Phase 13: Smart Sender Health - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Automated sender health management. Detect unhealthy senders (bounce rate, CAPTCHA, restriction, session expiry), remove them from campaign rotation without pausing campaigns, reassign pending LinkedIn actions to healthy senders, send tiered notifications, provide a sender swap workflow in admin UI, and add health history tracking with trend visualization on the existing /senders page.

</domain>

<decisions>
## Implementation Decisions

### Detection & Thresholds
- All signals monitored: bounce rate >5%, CAPTCHA/challenge detected, LinkedIn restriction, session cookie expired, manual admin flag
- Immediate flagging: flag sender as soon as threshold is breached in any 24h window (no sustained-period requirement)
- Hybrid recovery: soft flags (bounce rate normalized) auto-recover after cooldown; hard flags (CAPTCHA, restriction, session expiry) require manual admin reactivation
- Check frequency: piggyback on existing daily cron (6am UTC) — no extra infra cost

### Rotation & Reassignment
- Flagged sender removed from campaign rotation; campaign continues running with remaining healthy senders
- If workspace has only one sender and it's flagged: pause all campaigns in that workspace + fire urgent alert (Slack + email)
- Pending LinkedIn actions (connection requests, messages) auto-reassign to another healthy sender in the same workspace
- Admin can inline-swap a sender on a specific campaign via quick swap button on sender cards

### Notifications & Alerts
- Delivery channels: Slack + email
- Two-tier severity:
  - Warning (soft flags like bounce rate) → Slack notification only
  - Critical (CAPTCHA, restriction, last sender down, session expired) → Slack + email
- Timing: critical alerts fire immediately; warning-level alerts batched into daily health digest
- Slack destination: existing per-client reply channels (rise-replies, lime-recruitment-replies, etc.)

### Health Visibility & Trends
- Enhance existing /senders page (built in Phase 12) with health status badges, sparkline trends, and expandable health history — not a separate page
- Core metrics per sender: current status (healthy/warning/critical), bounce rate, last flag reason, flag history count, days since last incident
- 30-day rolling window for health history visualization (sparkline charts)
- Add sender health KPI card to dashboard command center: total healthy/warning/critical count with link to /senders

### Claude's Discretion
- Exact bounce rate calculation method (per-send vs rolling average)
- Health event database schema design
- Sparkline chart implementation details
- Daily digest email template layout
- Cooldown duration for soft-flag auto-recovery
- LinkedIn action reassignment priority logic (round-robin vs least-loaded)

</decisions>

<specifics>
## Specific Ideas

- Sender cards on /senders already exist from Phase 12 — extend them with health badges and inline swap, don't rebuild
- Dashboard KPI cards already exist from Phase 12 — add a health summary card in the same style
- Notification infra (Slack + email) already exists in src/lib/notifications.ts — extend, don't reinvent
- Cron job already runs daily at 6am UTC — add health check step to existing cron pipeline

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-smart-sender-health*
*Context gathered: 2026-03-02*
