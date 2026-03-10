# Requirements: Outsignal Lead Engine

**Defined:** 2026-03-10
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v4.0 Requirements

Requirements for Email Deliverability & Domain Infrastructure Monitoring. Each maps to roadmap phases.

### Domain Health

- [ ] **DOMAIN-01**: System validates SPF records for all sending domains via DNS lookup
- [ ] **DOMAIN-02**: System validates DKIM records for all sending domains (google, default, selector1, selector2 selectors)
- [ ] **DOMAIN-03**: System validates DMARC records and extracts policy for all sending domains
- [ ] **DOMAIN-04**: System checks ~50 major DNSBLs for domain/IP blacklist status (targeted: >3% bounce or 7+ days since last check)
- [ ] **DOMAIN-05**: DomainHealth model stores per-domain DNS status, blacklist hits, and overall health rating
- [ ] **DOMAIN-06**: Admin receives Slack + email notification when a domain is found on any blacklist
- [ ] **DOMAIN-07**: Admin receives warning notification when SPF/DKIM/DMARC validation fails

### Bounce Tracking

- [ ] **BOUNCE-01**: System captures daily per-sender-email bounce snapshots from EmailBison cumulative metrics
- [ ] **BOUNCE-02**: System computes daily deltas (sent, bounced, replied) between consecutive snapshots
- [ ] **BOUNCE-03**: Per-domain aggregate bounce metrics computed from sender-level snapshots
- [ ] **BOUNCE-04**: Bounce history retained for 30+ days per sender for trend analysis

### Placement Testing

- [ ] **PLACE-01**: Dashboard shows "Recommended for testing" badge on senders with >3% bounce rate
- [ ] **PLACE-02**: Admin can trigger placement test flow from dashboard (generates mail-tester.com address)
- [ ] **PLACE-03**: System fetches test results via mail-tester.com JSON API and stores in PlacementTest model
- [ ] **PLACE-04**: Historical placement test results displayed per sender on dashboard

### Auto-Rotation

- [ ] **ROTATE-01**: Bounce monitor runs every 4 hours checking all sender emails across workspaces
- [ ] **ROTATE-02**: Graduated health status: healthy (<3%), elevated (3-5%), warning (5-8%), critical (>8% or blacklisted)
- [ ] **ROTATE-03**: Auto-recovery when bounce rate sustained below 3% for 7 consecutive days
- [ ] **ROTATE-04**: EmailHealthEvent audit trail records all status transitions with reason and bounce percentage
- [ ] **ROTATE-05**: Admin receives notification with recommended action when sender reaches warning/critical status
- [ ] **ROTATE-06**: EmailBison sender management methods added (pause, daily limit, warmup) — feature-flagged pending API investigation

### Dashboard

- [ ] **DASH-01**: Deliverability page shows domain health cards with SPF/DKIM/DMARC badges and blacklist status
- [ ] **DASH-02**: Per-sender 30-day bounce rate sparklines on deliverability page
- [ ] **DASH-03**: Warmup status visualization (progress bars per sender)
- [ ] **DASH-04**: Auto-rotation activity feed showing recent EmailHealthEvent timeline
- [ ] **DASH-05**: Deliverability link added to admin sidebar navigation

### Intelligence Integration

- [ ] **INTEL-01**: Intelligence Hub shows deliverability summary bento card (domains healthy/at-risk, worst domain)
- [ ] **INTEL-02**: Insight records generated when senders transition to warning/critical
- [ ] **INTEL-03**: Weekly deliverability digest fires on Mondays with bounce trends and domain health summary

### Portal

- [ ] **PORTAL-01**: Client portal email-health page shows per-sender bounce rates and domain health badges

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Reputation

- **REP-01**: Google Postmaster Tools integration for Gmail-specific domain reputation
- **REP-02**: Microsoft SNDS integration for Outlook reputation tracking
- **REP-03**: Composite domain score combining all signals (DNS, blacklist, bounce, placement, ISP reputation)
- **REP-04**: Predictive alerts based on bounce rate trajectory

### Full Automation

- **AUTO-01**: Fully automated sender pause/unpause via EmailBison API (requires API support)
- **AUTO-02**: Automated daily limit adjustment based on sender health
- **AUTO-03**: Sending time optimization based on deliverability patterns

## Out of Scope

| Feature | Reason |
|---------|--------|
| Replacing EmailBison as sending infrastructure | EmailBison is the sending platform, we monitor/manage around it |
| Domain purchasing/provisioning | Handled externally by PlusVibe |
| Inbox placement testing with seed networks (GlockApps/Mailreach) | $49-125/mo, using mail-tester.com on-demand instead |
| Real-time bounce detection (sub-minute) | 4-hour monitoring sufficient, EmailBison webhooks cover immediate events |
| Per-email content spam scoring | Deferred — would require Claude calls per email, cost concern |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOMAIN-01 | — | Pending |
| DOMAIN-02 | — | Pending |
| DOMAIN-03 | — | Pending |
| DOMAIN-04 | — | Pending |
| DOMAIN-05 | — | Pending |
| DOMAIN-06 | — | Pending |
| DOMAIN-07 | — | Pending |
| BOUNCE-01 | — | Pending |
| BOUNCE-02 | — | Pending |
| BOUNCE-03 | — | Pending |
| BOUNCE-04 | — | Pending |
| PLACE-01 | — | Pending |
| PLACE-02 | — | Pending |
| PLACE-03 | — | Pending |
| PLACE-04 | — | Pending |
| ROTATE-01 | — | Pending |
| ROTATE-02 | — | Pending |
| ROTATE-03 | — | Pending |
| ROTATE-04 | — | Pending |
| ROTATE-05 | — | Pending |
| ROTATE-06 | — | Pending |
| DASH-01 | — | Pending |
| DASH-02 | — | Pending |
| DASH-03 | — | Pending |
| DASH-04 | — | Pending |
| DASH-05 | — | Pending |
| INTEL-01 | — | Pending |
| INTEL-02 | — | Pending |
| INTEL-03 | — | Pending |
| PORTAL-01 | — | Pending |

**Coverage:**
- v4.0 requirements: 30 total
- Mapped to phases: 0
- Unmapped: 30 ⚠️

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after initial definition*
