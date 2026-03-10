# Phase 29: Domain Health Foundation - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Schema, DNS validation library, bounce snapshots, warmup data capture, and daily cron — the data layer every downstream phase reads from. Covers DOMAIN-01 through DOMAIN-07 and BOUNCE-01 through BOUNCE-04. No auto-rotation (Phase 31), no dashboard UI (Phase 32), no placement testing (Phase 30).

</domain>

<decisions>
## Implementation Decisions

### Blacklist Checking Strategy
- Top 20 most impactful DNSBLs only (Spamhaus, Barracuda, SORBS, SpamCop, etc.) — the ones Gmail/Outlook actually check
- Check BOTH domain-level (URI DNSBLs) AND IP-level (traditional DNSBLs) — dedicated EmailBison IP means IP checks are relevant
- IP source: store known sending IP in `EMAILBISON_SENDING_IP` env var + auto-resolve from MX records as validation
- Tiered severity: Spamhaus + Barracuda = critical (immediate alert), others = warning (daily digest)
- Progressive domain checking: up to 4 domains per cron run, prioritizing domains with bounce issues or oldest-checked

### Notification Behavior
- Admin only for all deliverability notifications — clients don't see infrastructure alerts
- Blacklist hits: alert once on first detection, no repeated alerts (dashboard is persistent view). Alert again only for NEW list additions. Also notify on delisting (positive news)
- DNS record issues: first failure = warning, persistent after 48h = escalate to critical
- Blacklist notifications include direct removal/delisting links for the specific DNSBL
- Dedup window: alert once per new blacklist hit, suppress repeats. Dashboard serves as ongoing reference.

### Bounce Snapshot Granularity
- 20-send minimum gate for bounce rate computation — below 20 campaign sends, show "Insufficient campaign data" (no percentage, no health flag)
- No manual review step for low-volume senders — fully automated, just doesn't evaluate until 20+ sends
- Counter reset handling: if today's cumulative < yesterday's, treat as reset, null that day's delta (Claude's discretion)
- Per-domain rollup: weighted by volume (sender with 500 sends counts more than one with 20)
- EmailBison `emails_sent_count` tracks campaign sends only, not warmup sends — warmup traffic is separate

### EmailBison Warmup API Integration (NEW DISCOVERY)
- EmailBison has undiscovered warmup endpoints:
  - `GET /api/warmup/sender-emails` — list warmup data
  - `GET /api/warmup/sender-emails/{id}` — per-sender warmup details
  - `PATCH /api/warmup/sender-emails/enable` — enable warmup
  - `PATCH /api/warmup/sender-emails/disable` — disable warmup
  - `PATCH /api/sender-emails/{id}` — update sender email settings
- Phase 29 captures warmup health data alongside bounce snapshots (GET endpoints)
- PATCH endpoints for acting on data deferred to Phase 31 (auto-rotation)
- API reference: https://dedi.emailbison.com/api/reference

### Cron Scheduling
- Daily at 8am UTC via cron-job.org (2 hours after inbox-health at 6am)
- Separate from snapshot-metrics cron — different purposes, independent schedules
- 30s cron-job.org timeout: respond immediately, process DNS/blacklist checks asynchronously (Vercel function continues up to 60s)
- Keep separate cron jobs for domain-health and snapshot-metrics

### Claude's Discretion
- Exact DNSBL list composition (top 20 from the ones that matter)
- Counter reset detection algorithm
- Response-first pattern implementation (return 200 early, process in background)
- DKIM selector check order (google, default, selector1, selector2)
- BounceSnapshot model field names and exact schema

</decisions>

<specifics>
## Specific Ideas

- Dedicated EmailBison sending IP exists — store in `EMAILBISON_SENDING_IP` env var
- EmailBison warmup API at `dedi.emailbison.com/api/reference` has warmup health data — must integrate in this phase
- User wants zero manual work in the monitoring pipeline — everything automated, dashboard as the persistent reference
- Existing patterns to follow: `src/lib/linkedin/health-check.ts` for graduated flagging, `src/lib/inbox-health/monitor.ts` for workspace iteration

</specifics>

<deferred>
## Deferred Ideas

- EmailBison PATCH endpoints for sender management (pause, daily limits, warmup toggle) — Phase 31
- Auto-rotation engine using warmup + bounce data — Phase 31
- Deliverability dashboard UI — Phase 32
- Full EmailBison API investigation for all available endpoints — Phase 31

</deferred>

---

*Phase: 29-domain-health-foundation*
*Context gathered: 2026-03-10*
