# Brief: Admin Campaign Review & Approval Flow

## Goal
Build an admin-side campaign review experience on the existing campaign detail page (`/campaigns/[id]`). Admin reviews content + leads internally, then publishes to the client portal for their approval. The portal approval flow already works — this fills the gap before it.

## Current State
The admin campaign detail page (`src/app/(admin)/campaigns/[id]/page.tsx`) is read-only:
- Shows campaign name, status, lifecycle stepper, stats (lead count, step counts)
- Shows approval progress (read-only — no buttons)
- Has deploy button (only when status = `approved`)
- **Cannot view sequences, cannot view leads, cannot transition status**

## Design Requirements
- **MUST use the `/ui-ux-pro-max` skill** for all design decisions — component layout, spacing, colour, typography, visual hierarchy
- Follow existing admin dashboard design language (brand purple `#635BFF`, Geist fonts, warm stone neutrals)
- The campaign detail page is a key admin workflow — it needs to feel like a command centre, not a data dump
- Sequence preview should be visually clear with step numbering, delay indicators, and channel differentiation
- Lead table should highlight ICP scores with colour-coded badges (green >= 70, amber >= 40, gray < 40)

## What Needs Building

### 1. Content Preview Section
- Render the actual email/LinkedIn sequences on the admin detail page
- Reuse existing `SequenceFlowTimeline` component from `src/components/portal/sequence-flow-timeline.tsx` — it already handles both email and LinkedIn steps with a visual timeline, expandable cards, and delay pills
- For EB-synced email campaigns, also render `SequenceStepsDisplay` from `src/components/portal/sequence-steps-display.tsx`
- Data is already fetched: `campaign.emailSequence` and `campaign.linkedinSequence` are available (JSON strings, need parsing)

### 2. Lead List Preview Section
- Show a paginated table of the target list leads
- Use `getCampaignLeadSample(targetListId, workspaceSlug, 500)` from `src/lib/campaigns/operations.ts` — already exists
- Columns: Name, Job Title, Company, Location, LinkedIn URL, ICP Score (badge)
- Reference: `CampaignApprovalLeads` in `src/components/portal/campaign-approval-leads.tsx` uses this exact data shape

### 3. Status Transition Buttons
Add action buttons to the campaign detail header based on current status:

| Current Status | Button | Transition | API |
|---|---|---|---|
| `draft` | "Move to Review" | `draft → internal_review` | `PATCH /api/campaigns/[id]` with `{ status: "internal_review" }` |
| `internal_review` | "Publish for Client Review" | `internal_review → pending_approval` | `POST /api/campaigns/[id]/publish` (already exists, validates sequences + target list) |
| `pending_approval` | "Send Back to Review" | `pending_approval → internal_review` | New: `POST /api/campaigns/[id]/send-back` or reuse PATCH |

The state machine in `src/lib/campaigns/operations.ts` already validates these transitions. The `publishForReview()` function at the operations layer checks that at least one sequence exists and a target list is linked before allowing publish.

### 4. Tabbed Layout
Restructure the admin detail page into tabs to organise the new content:

- **Overview** — current stats grid, lifecycle stepper, approval progress, deploy history
- **Leads** — target list table with ICP scores
- **Content** — sequence preview (SequenceFlowTimeline for LinkedIn, SequenceStepsDisplay/accordion for email)

## What NOT to Build
- Admin-side approve/reject buttons — the admin doesn't approve content, they review it and push to the client. Client approves via portal.
- Content editing — sequences are managed through the agent pipeline, not edited inline
- New API routes for admin approval — not needed, the portal handles approval

## Key Files

### Modify
- `src/app/(admin)/campaigns/[id]/page.tsx` — add tabs, content preview, lead table, status buttons

### Reuse (already built)
- `src/components/portal/sequence-flow-timeline.tsx` — multi-channel visual timeline (move to `src/components/shared/` or import directly)
- `src/components/portal/sequence-steps-display.tsx` — EB sequence accordion
- `src/lib/campaigns/operations.ts` — `getCampaignLeadSample()`, `publishForReview()`, status transitions

### Existing API routes
- `POST /api/campaigns/[id]/publish` — transitions `internal_review → pending_approval`
- `PATCH /api/campaigns/[id]` — general campaign update (can update status for `draft → internal_review`)

## Data Shapes

LinkedIn sequence (stored as JSON string on `campaign.linkedinSequence`):
```typescript
{ position: number; type: "connection_request" | "message"; body: string; delayDays: number; notes?: string }[]
```

`SequenceFlowTimeline` expects:
```typescript
{ type: "linkedin"; position: number; actionType: "connect_request" | "message" | "follow_up" | ...; body?: string; delayDays: number }[]
```

Minor mapping needed: `type` field on stored data → `actionType` on timeline component.

Lead sample from `getCampaignLeadSample()`:
```typescript
{ personId: string; firstName: string; lastName: string; jobTitle: string; company: string; location: string; linkedinUrl: string; icpScore: number }[]
```

## Status State Machine (reference)

```
draft -> internal_review
internal_review -> pending_approval | draft
pending_approval -> approved | internal_review
approved -> deployed
deployed -> active
active -> paused | completed
paused -> active | completed
```

`pending_approval -> approved` happens automatically when both `leadsApproved` and `contentApproved` are set to true by the client in the portal.

## Acceptance Criteria
1. Admin can see full LinkedIn sequence copy (messages, delays, spintax) on campaign detail page
2. Admin can see full email sequence copy (subjects, bodies, A/B variants) on campaign detail page
3. Admin can see paginated lead list with ICP scores
4. Admin can click "Move to Review" on draft campaigns
5. Admin can click "Publish for Client Review" on internal_review campaigns (uses existing API)
6. Campaign appears in client portal as `pending_approval` with full approval wizard working
7. All UI designed using `/ui-ux-pro-max` skill, consistent with admin dashboard design language
