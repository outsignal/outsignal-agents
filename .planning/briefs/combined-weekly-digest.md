# PROJECT BRIEF: Combined Weekly Digest Email

## Objective

Merge the two weekly digest emails (Intelligence + Deliverability) into a single "Weekly Outsignal Digest" email. One email, every Monday, with everything a founder needs to see in 60 seconds.

## Current State

Two separate emails fire on Monday mornings:

| Email | Function | Trigger | Time |
|-------|----------|---------|------|
| Weekly Intelligence Digest | `notifyWeeklyDigestBundled()` in `src/lib/notifications.ts` (line 1696) | `trigger/generate-insights.ts` | 08:10 UTC (Monday only via `isMonday` guard) |
| Weekly Deliverability Digest | `notifyDeliverabilityDigest()` in `src/lib/notifications.ts` (line 1207) | `trigger/deliverability-digest.ts` | 08:20 UTC (Monday cron) |

Both use the same shared template helpers from `src/lib/email-template.ts` and send to `ADMIN_EMAIL` only.

## Design: Combined Email Layout

The combined email follows a **top-down priority structure** — most important information first, details below. Uses the existing `emailLayout()` wrapper with `#635BFF` purple accent, Geist Sans fonts, warm stone neutrals.

### Section 1: Header
```
emailHeading("Weekly Outsignal Digest", "Week of {date} — {totalWorkspaces} workspaces")
```

### Section 2: Executive Summary (4 stats in a row)
A single stats row showing the 4 most important numbers at a glance:

```
| Total Replies | Active Workspaces | Healthy Domains | Pending Actions |
|     21        |      3 / 10       |    28 / 31      |       29        |
```

Use `emailStatRow` (or build a 4-column variant). Colors:
- Total Replies: purple (`#635BFF`) — the key engagement metric
- Active Workspaces: neutral stone
- Healthy Domains: green if all healthy, red/amber if at-risk domains exist
- Pending Actions: amber if > 0, green if 0

### Section 3: Alerts (only if issues exist)
Only render this section if there are problem senders or at-risk domains. This is the "needs your attention" block.

```
emailLabel("Needs Attention")
```

**Problem Senders table** (max 5 rows — link to full list if more):
```
| Sender Email                              | Workspace        | Status   |
| charlie@riseheadwearusa.com               | Rise             | CRITICAL |
| lucy.l@limerecuk.co.uk                    | Lime Recruitment | CRITICAL |
```

Each row: sender email in monospace, workspace name in muted text, status as `emailPill` (red for critical, amber for warning).

**If no issues:** Skip this entire section — don't show an empty "all clear" block. Absence of alerts = good news.

### Section 4: Active Workspaces (campaign performance)
Only show workspaces with activity (replies > 0 OR insights > 0 OR pending actions > 0). Skip quiet workspaces entirely — just note the count at the bottom.

Per active workspace, render a compact card:

```
emailLabel("{Workspace Name}")

Reply count: 15 | Avg reply rate: 3.8% | Pending: 9

Best: People_UK_11:200 (5.63%)     Worst: Marketing_US_11:200 (2.37%)
```

- Workspace name as section label
- KPI line: replies, avg reply rate, pending actions count
- Best campaign: green text with reply rate
- Worst campaign: red text with reply rate (only show if different from best)
- Top 2 insights underneath (category pill + observation text) — only if insights exist
- Keep it compact — no more than ~6 lines per workspace

### Section 5: Deliverability Overview
Compact domain health summary — not per-domain, just the overview.

```
emailLabel("Deliverability")

Healthy: 28 | At-Risk: 3 | Transitions: 74
Worst domain: getoutsignal.com (warning)
```

**Bounce trends by workspace** (only show workspaces with data):
```
| Workspace        | Bounce Rate | Trend |
| Rise             | 2.4%        |  ↑    |
| Lime Recruitment | 1.8%        |  ↓    |
```

Trend arrows: ↑ red if increasing, ↓ green if decreasing, → grey if flat.

### Section 6: Quiet Workspaces (collapsed)
Single line at the bottom:
```
emailText("7 quiet this week: MyAcq, YoopKnows, BlankTag Media, Covenco, Situ, 1210 Solutions, Ladder Group")
```

Muted grey text, comma-separated names. No individual rows or cards.

### Section 7: CTA Button
```
emailButton("View Dashboard", "https://admin.outsignal.ai")
```

Single button linking to the main admin dashboard.

### Section 8: Footer
Standard `emailLayout` footer with:
```
"Weekly digest — Mondays at 8am UTC. You received this as the system administrator."
```

## Implementation

### Step 1: Create the combined function

In `src/lib/notifications.ts`, create a new function:

```typescript
export async function notifyWeeklyDigestCombined(
  workspaces: Array<{
    workspaceName: string;
    workspaceSlug: string;
    topInsights: Array<{ observation: string; category: string; confidence: string }>;
    bestCampaign: { name: string; replyRate: number } | null;
    worstCampaign: { name: string; replyRate: number } | null;
    pendingActions: number;
    replyCount?: number;
    avgReplyRate?: number;
    insightCount?: number;
  }>
): Promise<void>
```

This function:
1. Receives the same intelligence data it currently gets
2. Internally fetches the deliverability data (same queries as `notifyDeliverabilityDigest` does — healthy/at-risk domains, problem senders, bounce trends)
3. Builds a single combined email using the shared template helpers
4. Sends via the existing `sendEmail` / `audited()` pattern
5. Uses notification type: `weekly_digest_combined`

### Step 2: Update the trigger

In `trigger/generate-insights.ts`, replace the call to `notifyWeeklyDigestBundled()` with `notifyWeeklyDigestCombined()` inside the `isMonday` guard.

### Step 3: Remove the separate deliverability digest trigger

In `trigger/deliverability-digest.ts`, remove or comment out the email sending portion. Keep the Slack notification if it sends to a different channel (check if `notifyDeliverabilityDigest` also sends Slack — if so, keep the Slack part as a separate function or inline it).

### Step 4: Clean up

- Remove `notifyWeeklyDigestBundled()` (replaced by combined function)
- Keep `notifyDeliverabilityDigest()` only if it has Slack logic that needs to remain — otherwise remove it
- Update the idempotency check to use the new `weekly_digest_combined` type
- Keep per-workspace `notifyWeeklyDigest()` Slack notifications unchanged (those go to individual client Slack channels)

## Template Helpers Available

All from `src/lib/email-template.ts` (221 lines):

| Helper | Usage |
|--------|-------|
| `emailLayout({ body, footerNote })` | Full HTML wrapper with logo, purple accent, white card |
| `emailHeading(title, subtitle?)` | Large heading + subtitle |
| `emailButton(label, href)` | Purple CTA button (#635BFF) |
| `emailStatBox(value, label, color, bgColor)` | Large number stat card |
| `emailStatRow(left, right)` | Two-column stat layout |
| `emailStatRow3(col1, col2, col3)` | Three-column stat layout |
| `emailLabel(text)` | Uppercase muted section label |
| `emailText(text)` | Body paragraph |
| `emailBanner(text, { color, bgColor, borderColor })` | Alert box |
| `emailPill(label, color, bgColor)` | Status pill (critical/warning/healthy) |
| `emailNotice(text)` | Muted info box |
| `emailDivider()` | Horizontal rule |
| `emailDetailCard(rows)` | Key-value detail rows |
| `emailCallout(text)` | Accent-bordered callout |

You may need to add a `emailStatRow4()` helper for the 4-column executive summary, following the same pattern as `emailStatRow3`.

## Design Guidelines

- **Flat design**: No gradients, no shadows, clean lines. Use color and spacing for hierarchy.
- **Brand colors**: `#635BFF` purple accent, `#F8F7F5` warm stone background, white card body
- **Font**: Geist Sans (already in email template as font-family stack)
- **Status colors**: Use existing pill colors — red for critical, amber for warning, green for healthy
- **Scannable**: A busy founder should get the full picture from Section 1-2 (stats + alerts) in 10 seconds. Sections 3-5 are for detail.
- **No emojis**: Use text characters for trend arrows (↑ ↓ →), not emoji
- **Mobile friendly**: Email tables should stack on small screens. Use inline styles (email requirement).

## Files to Change

| File | Change |
|------|--------|
| `src/lib/notifications.ts` | Add `notifyWeeklyDigestCombined()`, remove `notifyWeeklyDigestBundled()` |
| `src/lib/email-template.ts` | Add `emailStatRow4()` if needed |
| `trigger/generate-insights.ts` | Replace `notifyWeeklyDigestBundled` call with `notifyWeeklyDigestCombined` |
| `trigger/deliverability-digest.ts` | Remove email portion, keep Slack if applicable |

## Files NOT to Change

| File | Reason |
|------|--------|
| `prisma/schema.prisma` | No schema changes |
| `src/lib/domain-health/*` | Domain health logic unchanged |
| `trigger/bounce-monitor.ts` | Bounce monitor unchanged |
| Any UI components | This is email-only |

## Acceptance Criteria

1. Single weekly email arrives on Monday mornings with both intelligence and deliverability data
2. Email follows the section layout described above (executive summary → alerts → active workspaces → deliverability → quiet workspaces)
3. Uses existing template helpers for consistent brand styling
4. Problem senders section only appears when there are problems
5. Quiet workspaces collapsed to a single line
6. Old `weekly_digest_bundled` and separate `deliverability_digest` emails no longer send
7. Per-workspace Slack notifications remain unchanged
8. Slack portion of deliverability digest remains unchanged (if it exists)
9. Notification audit logging works with new `weekly_digest_combined` type
10. Build passes (`npm run build`)

## Reference: Current Data Sources

**Intelligence data** (passed as params from `trigger/generate-insights.ts`):
- Per-workspace: reply count, avg reply rate, best/worst campaign, top insights, pending actions

**Deliverability data** (queried in `notifyDeliverabilityDigest`):
- `prisma.domainHealth` — healthy vs at-risk domain counts, worst domain
- `prisma.sender` — problem senders (warning/critical `emailBounceStatus`)
- `prisma.emailHealthEvent` — transition count (last 7 days)
- Workspace bounce trends — avg bounce rate current vs 7 days ago
