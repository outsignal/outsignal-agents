# Requirements: Outsignal Lead Engine

**Defined:** 2026-03-10
**Core Value:** Own the lead data pipeline end-to-end so we never pay for the same lead twice and can cancel the $300+/month Clay subscription.

## v4.0 Requirements

Requirements for Email Deliverability & Domain Infrastructure Monitoring. Each maps to roadmap phases.

### Domain Health

- [x] **DOMAIN-01**: System validates SPF records for all sending domains via DNS lookup
- [x] **DOMAIN-02**: System validates DKIM records for all sending domains (google, default, selector1, selector2 selectors)
- [x] **DOMAIN-03**: System validates DMARC records and extracts policy for all sending domains
- [x] **DOMAIN-04**: System checks ~50 major DNSBLs for domain/IP blacklist status (targeted: >3% bounce or 7+ days since last check)
- [x] **DOMAIN-05**: DomainHealth model stores per-domain DNS status, blacklist hits, and overall health rating
- [x] **DOMAIN-06**: Admin receives Slack + email notification when a domain is found on any blacklist
- [x] **DOMAIN-07**: Admin receives warning notification when SPF/DKIM/DMARC validation fails

### Bounce Tracking

- [x] **BOUNCE-01**: System captures daily per-sender-email bounce snapshots from EmailBison cumulative metrics
- [x] **BOUNCE-02**: System computes daily deltas (sent, bounced, replied) between consecutive snapshots
- [x] **BOUNCE-03**: Per-domain aggregate bounce metrics computed from sender-level snapshots
- [x] **BOUNCE-04**: Bounce history retained for 30+ days per sender for trend analysis

### Placement Testing

- [x] **PLACE-01**: Dashboard shows "Recommended for testing" badge on senders with >3% bounce rate
- [x] **PLACE-02**: Admin can trigger placement test flow from dashboard (generates mail-tester.com address)
- [x] **PLACE-03**: System fetches test results via mail-tester.com JSON API and stores in PlacementTest model
- [x] **PLACE-04**: Historical placement test results displayed per sender on dashboard

### Auto-Rotation

- [x] **ROTATE-01**: Bounce monitor runs every 4 hours checking all sender emails across workspaces
- [x] **ROTATE-02**: Graduated health status: healthy (<2%), elevated (2-3%), warning (3-5%), critical (>5% or blacklisted)
- [x] **ROTATE-03**: Auto-recovery via gradual step-down (one level per 24h sustained below threshold, 6 consecutive checks)
- [x] **ROTATE-04**: EmailHealthEvent audit trail records all status transitions with reason and bounce percentage
- [x] **ROTATE-05**: Admin receives notification with recommended action when sender reaches warning/critical status
- [x] **ROTATE-06**: EmailBison sender management methods added (pause, daily limit, warmup) — feature-flagged pending API investigation

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

## v5.0 Requirements

Requirements for Client Portal Inbox. Each maps to roadmap phases.

### API Foundation

- [ ] **API-01**: EmailBison sendReply endpoint validated via live spike test
- [ ] **API-02**: EmailBison client extended with sendReply(), getReply(), getRepliesPage() methods
- [ ] **API-03**: LinkedIn Voyager client extended with fetchConversations() and fetchMessages() methods
- [ ] **API-04**: Worker exposes GET /sessions/{senderId}/conversations endpoint

### LinkedIn Data

- [ ] **LI-01**: LinkedInConversation model stores conversation metadata with participant info
- [ ] **LI-02**: LinkedInMessage model stores messages with outbound/inbound flag
- [ ] **LI-03**: LinkedIn sync API triggers async worker fetch with 5-min cache
- [ ] **LI-04**: Sync matches participants to Person records by LinkedIn URL

### Email Inbox

- [ ] **EMAIL-01**: Email thread list API groups replies by parent_id chain into threads
- [ ] **EMAIL-02**: Email thread detail API returns chronological messages with outbound context
- [ ] **EMAIL-03**: Client can send email reply from portal with sender selection
- [ ] **EMAIL-04**: AI suggested reply displayed as "Use this" prefill option

### LinkedIn Inbox

- [ ] **LIIN-01**: LinkedIn conversation list shows recent conversations from DB
- [ ] **LIIN-02**: LinkedIn conversation detail shows full message history
- [ ] **LIIN-03**: Client can queue LinkedIn reply from portal (priority 1 LinkedInAction)
- [ ] **LIIN-04**: Manual refresh triggers re-sync from Voyager API

### Inbox UI

- [ ] **UI-01**: Two-panel layout (thread list left, conversation right)
- [ ] **UI-02**: Channel tabs (All / Email / LinkedIn) based on workspace package
- [ ] **UI-03**: Unread indicators on threads with unread count in nav
- [ ] **UI-04**: Message bubbles (inbound left, outbound right) with intent/sentiment badges
- [ ] **UI-05**: Reply composer with email mode (Send) and LinkedIn mode (Queue Message)
- [ ] **UI-06**: Mobile single-panel layout with back navigation
- [ ] **UI-07**: Cross-channel indicator when same person active on both email + LinkedIn

### Admin Inbox

- [ ] **ADMIN-01**: Master inbox page on admin dashboard showing all workspaces
- [ ] **ADMIN-02**: Workspace filter dropdown (default: All, can select specific workspace)
- [ ] **ADMIN-03**: Same two-panel UI reused from portal inbox components
- [ ] **ADMIN-04**: Admin can reply on behalf of any workspace (email + LinkedIn)

### Navigation

- [ ] **NAV-01**: Portal sidebar replaces "Replies" with "Inbox"
- [ ] **NAV-02**: Admin sidebar adds "Inbox" nav item

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
| WebSockets/SSE for real-time inbox | Vercel serverless has no persistent connections — polling sufficient at current volume |
| Rich text editor (Tiptap/ProseMirror) | HTML emails hurt cold outbound deliverability — plain text replies only |
| Bulk reply from inbox | Mass replying to cold outbound is dangerous — each reply needs individual attention |
| Attachment sending | Attachments in cold outbound replies hurt deliverability — text-only |
| Unified cross-channel thread merging | Email + LinkedIn threading models incompatible — keep separate with cross-channel indicator |
| Draft auto-save | At ~5-20 replies/day, drafts are over-engineering — composer state lives in React state |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DOMAIN-01 | Phase 29 | Complete |
| DOMAIN-02 | Phase 29 | Complete |
| DOMAIN-03 | Phase 29 | Complete |
| DOMAIN-04 | Phase 29 | Complete |
| DOMAIN-05 | Phase 29 | Complete |
| DOMAIN-06 | Phase 29 | Complete |
| DOMAIN-07 | Phase 29 | Complete |
| BOUNCE-01 | Phase 29 | Complete |
| BOUNCE-02 | Phase 29 | Complete |
| BOUNCE-03 | Phase 29 | Complete |
| BOUNCE-04 | Phase 29 | Complete |
| PLACE-01 | Phase 30 | Complete |
| PLACE-02 | Phase 30 | Complete |
| PLACE-03 | Phase 30 | Complete |
| PLACE-04 | Phase 30 | Complete |
| ROTATE-01 | Phase 31 | Complete |
| ROTATE-02 | Phase 31 | Complete |
| ROTATE-03 | Phase 31 | Complete |
| ROTATE-04 | Phase 31 | Complete |
| ROTATE-05 | Phase 31 | Complete |
| ROTATE-06 | Phase 31 | Complete |
| DASH-01 | Phase 32 | Pending |
| DASH-02 | Phase 32 | Pending |
| DASH-03 | Phase 32 | Pending |
| DASH-04 | Phase 32 | Pending |
| DASH-05 | Phase 32 | Pending |
| INTEL-01 | Phase 32 | Pending |
| INTEL-02 | Phase 32 | Pending |
| INTEL-03 | Phase 32 | Pending |
| PORTAL-01 | Phase 32 | Pending |
| API-01 | Phase 33 | Pending |
| API-02 | Phase 33 | Pending |
| API-03 | Phase 33 | Pending |
| API-04 | Phase 33 | Pending |
| LI-01 | Phase 34 | Pending |
| LI-02 | Phase 34 | Pending |
| LI-03 | Phase 34 | Pending |
| LI-04 | Phase 34 | Pending |
| EMAIL-01 | Phase 35 | Pending |
| EMAIL-02 | Phase 35 | Pending |
| EMAIL-03 | Phase 35 | Pending |
| EMAIL-04 | Phase 35 | Pending |
| LIIN-01 | Phase 36 | Pending |
| LIIN-02 | Phase 36 | Pending |
| LIIN-03 | Phase 36 | Pending |
| LIIN-04 | Phase 36 | Pending |
| UI-01 | Phase 37 | Pending |
| UI-02 | Phase 37 | Pending |
| UI-03 | Phase 37 | Pending |
| UI-04 | Phase 37 | Pending |
| UI-05 | Phase 37 | Pending |
| UI-06 | Phase 37 | Pending |
| UI-07 | Phase 37 | Pending |
| ADMIN-01 | Phase 37 | Pending |
| ADMIN-02 | Phase 37 | Pending |
| ADMIN-03 | Phase 37 | Pending |
| ADMIN-04 | Phase 37 | Pending |
| NAV-01 | Phase 37 | Pending |
| NAV-02 | Phase 37 | Pending |

**Coverage:**
- v4.0 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0 ✓

- v5.0 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-11 after v5.0 roadmap creation — all 27 v5.0 requirements mapped*
