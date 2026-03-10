# Phase 26: Cross-Workspace Benchmarking & ICP Calibration - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Benchmark workspace performance against global averages and hardcoded industry reference bands, calibrate ICP scores against actual conversion outcomes with threshold recommendations, and show signal-type effectiveness ranked by reply outcomes. All views live on a new "Benchmarks" tab on the existing `/admin/analytics` page.

</domain>

<decisions>
## Implementation Decisions

### Benchmark reference bands
- **Dual baselines** — show both global average (computed from all workspaces' CachedMetrics) AND hardcoded industry reference bands per vertical
- **Channel-aware metrics** — metrics depend on workspace channels:
  - Email workspaces: reply rate, bounce rate, interested rate
  - LinkedIn workspaces: connection accept rate, message reply rate
  - Multi-channel: both sets of metrics
- **Gauge/thermometer visualization** — horizontal bar with colored zones (red/yellow/green) for low/avg/high, workspace's value shown as a marker on the bar
- **Industry benchmarks** — hardcode initial reference data for the 6 active verticals (Branded Merchandise, Recruitment Services, Architecture Project Management, B2B Lead Generation, Business Acquisitions, Umbrella Company Solutions). Easy to update later
- **Always all-time data** — benchmarks don't respect the time period filter, always use full dataset for statistical significance

### ICP calibration display
- **Bucket chart** — group ICP scores into buckets (0-20, 21-40, 41-60, 61-80, 81-100) and show reply/interested rate per bucket as a bar chart
- **ICP source** — `Person.icpScore` field, cross-referenced with Reply outcomes
- **Recommendation card** — below the bucket chart showing suggested threshold adjustment with current vs recommended threshold, evidence (sample size, rate comparison), and confidence indicator
- **Per-workspace with global toggle** — default shows calibration for selected workspace (ICP criteria differ by vertical), toggle to see global view

### Signal-type effectiveness
- **Signal data is comprehensive** — `SignalEvent` model tracks 6 signal types (job_change, funding, hiring_spike, tech_adoption, news, social_mention), `Campaign.signalTypes` links campaigns to triggers, `SignalCampaignLead` tracks outcomes per lead
- **Ranked signal cards** — one card per signal type showing reply rate, interested rate, and volume, ranked best to worst
- **Signal vs static comparison** — show signal campaign metrics alongside static campaign baseline to answer "is signal-based targeting outperforming cold outreach?"
- **Per-workspace with global toggle** — same pattern as ICP calibration

### Benchmarking view layout
- **New "Benchmarks" tab** on existing `/admin/analytics` page — three tabs: Performance | Copy | Benchmarks
- **Vertical stack** within the tab — Reference Bands at top, ICP Calibration middle, Signal Effectiveness bottom (same scroll-down pattern as Copy tab)
- **Shared page-level workspace filter** — uses existing workspace selector in analytics page header
- **All-time data only** — benchmarks ignore the time period filter for statistical significance

### Claude's Discretion
- Gauge/thermometer color zones and breakpoints
- Exact industry benchmark values per vertical (research reasonable defaults)
- Bucket chart styling and bar colors
- Recommendation card confidence threshold logic
- How to handle workspaces with no signal campaigns (empty state)
- Signal vs static comparison card visual design

</decisions>

<specifics>
## Specific Ideas

- Channel-aware benchmarks are critical — comparing a LinkedIn-only workspace's "reply rate" against email metrics would be misleading
- The signal vs static comparison is the key insight for this section — if signal campaigns outperform by 3x, that's immediately actionable for the admin
- ICP threshold recommendation should include specific numbers: "raise from 60 to 72" with evidence, not vague "consider adjusting"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 26-cross-workspace-benchmarking-icp-calibration*
*Context gathered: 2026-03-10*
