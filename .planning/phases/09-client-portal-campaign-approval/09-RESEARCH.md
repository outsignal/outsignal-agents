# Phase 9: Client Portal Campaign Approval - Research

**Researched:** 2026-03-01
**Domain:** Next.js App Router portal pages, campaign approval API routes, Slack/email notifications
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Portal campaign list view**
- Card grid layout at /portal/campaigns
- Show ALL campaigns for the workspace, pending campaigns sorted to the top with notification badge
- Each card shows: campaign name, status badge, channels (email/linkedin icons), and two small approval indicators (leads approved/pending, content approved/pending)
- Use existing portal auth (middleware rewrite to /portal/*) — no new auth system

**Lead preview & approval UX**
- Display top 50 leads by ICP score descending — fixed sort, not sortable columns
- Fields per lead row: name, title, company, location, LinkedIn (link to profile)
- "Approve Leads" button and "Request Changes" button side by side
- On "Request Changes": text area appears for client feedback (e.g., "too many US-based leads, need more UK"). Feedback saved to Campaign.leadsFeedback

**Content preview & approval UX**
- Email sequence displayed as vertical accordion — each step collapsible: "Step 1 (Day 0)", "Step 2 (Day 3)", etc. First step expanded by default
- Merge tokens ({FIRSTNAME}, {COMPANYNAME}) replaced with example data in preview — client sees what the actual email looks like. Subtle highlight on personalized parts
- Spintax resolved to one variant in preview — client doesn't see spintax syntax
- LinkedIn messages displayed in a separate section below email content, clearly labeled "LinkedIn Messages"
- "Approve Content" and "Request Changes" buttons with same feedback pattern as leads

**Notification behavior**
- Structured Slack block notifications: header "[Rise] Campaign Update", body shows what was approved/rejected, client feedback text if rejection, "View Campaign" action button
- Notifications go to a **dedicated approvals channel** (not the workspace reply channel)
- Email notifications include full feedback text inline — admin gets full context without clicking through
- When BOTH leads AND content are approved (dual approval), a distinct "fully approved" notification fires: "Campaign fully approved — auto-deploy triggered"

### Claude's Discretion
- Exact card styling and responsive behavior
- Accordion implementation details
- Example data used for merge token preview (e.g., which sample names/companies)
- Slack channel naming convention for the approvals channel
- Email template layout details
- How "auto-deploy triggered" connects to Phase 10 (just the status transition + event, actual deploy is Phase 10)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PORTAL-01 | Client sees campaigns tab in portal with pending notification badges | Card grid page at /portal/campaigns; pending badge count derived from campaigns where status === 'pending_approval' and neither leads nor content fully approved |
| PORTAL-02 | Campaign detail shows lead sample (top N by ICP score) with key fields (name, title, company, location, LinkedIn) | New portal API route queries TargetListPerson → Person → PersonWorkspace (for icpScore), orders by icpScore DESC, takes 50 |
| PORTAL-03 | Client can approve leads or request changes with feedback text | POST /api/portal/campaigns/[id]/approve-leads and /request-changes-leads; saves leadsApproved/leadsFeedback; triggers notifications |
| PORTAL-04 | Campaign detail shows content preview — email sequence steps (subject + body) and LinkedIn messages | Read Campaign.emailSequence + linkedinSequence JSON; render with spintax resolution and merge token substitution |
| PORTAL-05 | Client can approve content or request changes with feedback text | POST /api/portal/campaigns/[id]/approve-content and /request-changes-content; saves contentApproved/contentFeedback; triggers notifications |
| PORTAL-06 | Lead approval and content approval are independent — one does not affect the other | Two separate API routes and separate DB fields (leadsApproved, contentApproved) — no shared state |
| PORTAL-07 | Portal endpoints enforce workspace ownership via session | getPortalSession() called first in every /api/portal/campaigns/* route; compare campaign.workspaceSlug === session.workspaceSlug |
| NOTIF-01 | Admin receives Slack notification when client approves or rejects (leads or content) | New notifyApproval() function in notifications.ts; uses workspace.approvalsSlackChannelId (new field) or falls back to slackChannelId |
| NOTIF-02 | Admin receives email notification when client approves or rejects (leads or content) | Same notifyApproval() function sends email via sendNotificationEmail() to workspace.notificationEmails |
</phase_requirements>

## Summary

Phase 9 adds the client-facing campaign approval flow to an already-working portal shell. The portal already has auth (magic link + HMAC-signed cookie), middleware rewrite for `portal.outsignal.ai`, session helpers (`getPortalSession()`), layout, and nav components. The Campaign model already has all needed approval fields: `leadsApproved`, `leadsFeedback`, `leadsApprovedAt`, `contentApproved`, `contentFeedback`, `contentApprovedAt`, `status`, `emailSequence`, `linkedinSequence`, and `targetListId`. No schema migrations are needed except adding an `approvalsSlackChannelId` field to Workspace to support the dedicated approvals channel decision.

The main work is: (1) new portal pages (campaign list + campaign detail), (2) new portal API routes for approval/rejection actions with workspace ownership enforcement, (3) a `notifyApproval()` function for Slack + email notifications, (4) the dual-approval → `approved` status transition logic, and (5) content preview utilities for spintax resolution and merge token substitution.

The existing codebase patterns are mature and consistent: server components with `getPortalSession()` for data fetching, API routes as thin wrappers over operations functions in `src/lib/`, Slack via `postMessage()` with KnownBlock arrays, email via `sendNotificationEmail()` with inline HTML. This phase follows those same patterns throughout.

**Primary recommendation:** Build portal pages as Next.js server components, new portal API routes at `/api/portal/campaigns/*`, extend `notifications.ts` with `notifyApproval()`, and add `approvalsSlackChannelId` + `approvalsSlackChannelName` to Workspace schema.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | 16.x (project's installed version) | Server components, API routes, middleware | Already in use throughout project |
| Prisma | 6.x | DB queries for Campaign, TargetListPerson, PersonWorkspace | Already used for all DB ops |
| @slack/web-api | Latest installed | Slack block notifications via postMessage() | Already used in slack.ts |
| resend | Latest installed | Email notifications via sendNotificationEmail() | Already used in resend.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn/ui components | Installed | Card, Badge, Table, Tabs, Button, Textarea, Skeleton | All portal page UI |
| lucide-react | Installed | Channel icons (Mail, Linkedin), approval state icons | Icon-only representations |
| tailwindcss | Installed | Layout, spacing, brand color (#F0FF7A) | All styling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server component data fetch | Client-side React Query | Server components simpler, fits existing portal pattern (portal/page.tsx and portal/linkedin/page.tsx both use server components) |
| Custom accordion | Shadcn's Accordion / Tabs | shadcn's Tabs component is already installed; the Accordion isn't listed in the UI component inventory — use Tabs for the email steps OR implement a simple stateful client component accordion |
| Inline spintax parser | External library | Spintax format is simple ({A\|B\|C}) — hand-rolled one-liner is appropriate, no external dependency needed |

**Installation:** No new packages needed — all required libraries are already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/
│   ├── (portal)/
│   │   └── portal/
│   │       ├── campaigns/
│   │       │   ├── page.tsx                    # Campaign list — server component
│   │       │   └── [id]/
│   │       │       └── page.tsx                # Campaign detail — server component + client children
│   │       └── layout.tsx                      # Existing — add "Campaigns" to PortalNav
├── app/api/portal/campaigns/
│   │   ├── route.ts                            # GET /api/portal/campaigns (list)
│   │   └── [id]/
│   │       ├── route.ts                        # GET /api/portal/campaigns/[id]
│   │       ├── approve-leads/route.ts          # POST — approve leads
│   │       ├── request-changes-leads/route.ts  # POST — reject leads with feedback
│   │       ├── approve-content/route.ts        # POST — approve content
│   │       └── request-changes-content/route.ts # POST — reject content with feedback
├── lib/
│   ├── campaigns/
│   │   └── operations.ts                       # Existing — add approveCampaignLeads(), rejectCampaignLeads(), approveCampaignContent(), rejectCampaignContent()
│   ├── notifications.ts                        # Existing — add notifyApproval()
│   └── content-preview.ts                      # NEW — resolveSpintax(), substituteTokens()
└── components/portal/
    ├── portal-nav.tsx                          # Existing — add Campaigns nav item
    ├── campaign-card.tsx                       # NEW — client component for campaign list card
    ├── campaign-approval-leads.tsx             # NEW — lead table + approve/reject buttons (client)
    └── campaign-approval-content.tsx           # NEW — content accordion + approve/reject buttons (client)
```

### Pattern 1: Portal Server Component with Session Guard
**What:** Every portal page calls `getPortalSession()` at the top. Throws if no session (middleware redirects first, but this is the belt-and-suspenders guard for API routes).
**When to use:** All portal pages and API routes.
**Example:**
```typescript
// src/app/(portal)/portal/campaigns/page.tsx
import { getPortalSession } from "@/lib/portal-session";
import { listCampaigns } from "@/lib/campaigns/operations";

export default async function PortalCampaignsPage() {
  const { workspaceSlug } = await getPortalSession();
  const campaigns = await listCampaigns(workspaceSlug);
  // campaigns are already scoped to the session workspace — safe
  // Sort: pending_approval first, then rest by updatedAt desc
  const sorted = [
    ...campaigns.filter(c => c.status === 'pending_approval'),
    ...campaigns.filter(c => c.status !== 'pending_approval'),
  ];
  return <CampaignGrid campaigns={sorted} />;
}
```

### Pattern 2: Portal API Route with Ownership Check
**What:** API routes call `getPortalSession()`, load the campaign by ID, then verify `campaign.workspaceSlug === session.workspaceSlug` before any mutation.
**When to use:** All `/api/portal/campaigns/*` routes (PORTAL-07).
**Example:**
```typescript
// src/app/api/portal/campaigns/[id]/approve-leads/route.ts
import { getPortalSession } from "@/lib/portal-session";
import { getCampaign, approveCampaignLeads } from "@/lib/campaigns/operations";
import { notifyApproval } from "@/lib/notifications";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try {
    session = await getPortalSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (campaign.workspaceSlug !== session.workspaceSlug) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updated = await approveCampaignLeads(id);

  // Non-blocking notification
  notifyApproval({
    workspaceSlug: session.workspaceSlug,
    campaignId: id,
    campaignName: campaign.name,
    action: "leads_approved",
    feedback: null,
  }).catch(err => console.error("Approval notification failed:", err));

  return NextResponse.json({ campaign: updated });
}
```

### Pattern 3: Operations Layer for Approval Mutations
**What:** All DB mutations go in `src/lib/campaigns/operations.ts`. The operations check dual-approval and transition status to 'approved' automatically when both are true.
**When to use:** `approveCampaignLeads()`, `approveCampaignContent()`, `rejectCampaignLeads()`, `rejectCampaignContent()`.
**Example:**
```typescript
// In operations.ts
export async function approveCampaignLeads(id: string): Promise<CampaignDetail> {
  const current = await prisma.campaign.findUnique({ where: { id } });
  if (!current) throw new Error(`Campaign not found: '${id}'`);

  const updateData: Record<string, unknown> = {
    leadsApproved: true,
    leadsApprovedAt: new Date(),
    leadsFeedback: null, // clear any previous feedback on approval
  };

  // Dual approval check: if content is ALSO already approved, transition to 'approved'
  if (current.contentApproved && current.status === 'pending_approval') {
    updateData.status = 'approved';
  }

  const campaign = await prisma.campaign.update({
    where: { id },
    data: updateData,
    include: targetListInclude,
  });

  return formatCampaignDetail(campaign);
}

export async function rejectCampaignLeads(id: string, feedback: string): Promise<CampaignDetail> {
  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      leadsApproved: false,
      leadsFeedback: feedback,
    },
    include: targetListInclude,
  });
  return formatCampaignDetail(campaign);
}
```

### Pattern 4: Lead Sample Query (top 50 by ICP score)
**What:** Fetch top 50 people in a TargetList ordered by their ICP score for this workspace.
**Key insight:** ICP score lives on `PersonWorkspace` (not `Person`). The join is: `TargetListPerson → Person → PersonWorkspace` filtered by `workspace === workspaceSlug`.
**Example:**
```typescript
export async function getCampaignLeadSample(
  targetListId: string,
  workspaceSlug: string,
  limit = 50,
): Promise<LeadSample[]> {
  const members = await prisma.targetListPerson.findMany({
    where: { listId: targetListId },
    include: {
      person: {
        include: {
          workspaces: {
            where: { workspace: workspaceSlug },
            select: { icpScore: true },
          },
        },
      },
    },
  });

  return members
    .map(m => ({
      personId: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      jobTitle: m.person.jobTitle,
      company: m.person.company,
      location: m.person.location,
      linkedinUrl: m.person.linkedinUrl,
      icpScore: m.person.workspaces[0]?.icpScore ?? null,
    }))
    .sort((a, b) => (b.icpScore ?? -1) - (a.icpScore ?? -1))
    .slice(0, limit);
}
```

### Pattern 5: Spintax Resolution + Merge Token Substitution
**What:** Two utility functions in `src/lib/content-preview.ts`. Simple, no external dependency.
**Spintax format:** `{Option A|Option B|Option C}` — pick index 0 (deterministic preview, consistent for the same session)
**Merge token format:** `{FIRSTNAME}`, `{COMPANYNAME}`, etc.
**Example:**
```typescript
// src/lib/content-preview.ts

const EXAMPLE_DATA: Record<string, string> = {
  FIRSTNAME: "Alex",
  LASTNAME: "Smith",
  COMPANYNAME: "Acme Corp",
  COMPANY: "Acme Corp",
  JOBTITLE: "Head of Operations",
  WEBSITE: "acmecorp.com",
};

/**
 * Resolve spintax: {A|B|C} → A (always picks first variant for consistent preview)
 */
export function resolveSpintax(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (match, inner) => {
    const options = inner.split("|");
    // If it looks like a merge token (no pipe), leave it alone for substituteTokens
    if (options.length === 1) return match;
    return options[0].trim();
  });
}

/**
 * Substitute merge tokens with example data.
 * Returns both the substituted text and a list of original tokens found (for highlighting).
 */
export function substituteTokens(text: string): {
  result: string;
  tokensFound: string[];
} {
  const tokensFound: string[] = [];
  const result = text.replace(/\{([A-Z_]+)\}/g, (match, token) => {
    if (EXAMPLE_DATA[token]) {
      tokensFound.push(token);
      return EXAMPLE_DATA[token];
    }
    return match; // unknown token — leave as-is
  });
  return { result, tokensFound };
}

/**
 * Full preview pipeline: spintax first, then tokens.
 */
export function renderContentPreview(raw: string): string {
  const afterSpintax = resolveSpintax(raw);
  const { result } = substituteTokens(afterSpintax);
  return result;
}
```

**Note on highlighting personalized parts:** In the client component, call `substituteTokens()` separately after `resolveSpintax()` to get `tokensFound`, then wrap replacement text in `<mark>` or a styled span.

### Pattern 6: notifyApproval() notification function
**What:** Extend `src/lib/notifications.ts` with a `notifyApproval()` function following the same pattern as `notifyReply()`.
**Key difference from existing:** Approvals go to a dedicated approvals channel (new `Workspace.approvalsSlackChannelId` field), not the replies channel (`Workspace.slackChannelId`).
**Dual-approval trigger:** When `action === 'both_approved'`, send a distinct "fully approved" notification. The caller checks if `updated.leadsApproved && updated.contentApproved` after the mutation.
**Example:**
```typescript
export async function notifyApproval(params: {
  workspaceSlug: string;
  campaignId: string;
  campaignName: string;
  action: 'leads_approved' | 'leads_rejected' | 'content_approved' | 'content_rejected' | 'both_approved';
  feedback: string | null;
}): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { slug: params.workspaceSlug } });
  if (!workspace) return;

  const isFullyApproved = params.action === 'both_approved';
  const isRejection = params.action.includes('rejected');

  const headerText = isFullyApproved
    ? `[${workspace.name}] Campaign Fully Approved`
    : `[${workspace.name}] Campaign Update`;

  const actionLabel: Record<string, string> = {
    leads_approved: 'Leads approved',
    leads_rejected: 'Changes requested for leads',
    content_approved: 'Content approved',
    content_rejected: 'Changes requested for content',
    both_approved: 'Both leads and content approved — auto-deploy triggered',
  };

  const campaignUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://admin.outsignal.ai'}/campaigns/${params.campaignId}`;

  // Slack
  const slackChannelId = workspace.approvalsSlackChannelId ?? workspace.slackChannelId;
  if (slackChannelId) {
    try {
      await postMessage(slackChannelId, headerText, [
        { type: 'header', text: { type: 'plain_text', text: headerText } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Campaign:* ${params.campaignName}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*Status:* ${actionLabel[params.action]}` } },
        ...(isRejection && params.feedback ? [{
          type: 'section' as const,
          text: { type: 'mrkdwn' as const, text: `*Feedback:*\n${params.feedback}` },
        }] : []),
        {
          type: 'actions',
          elements: [{ type: 'button', text: { type: 'plain_text', text: 'View Campaign' }, url: campaignUrl }],
        },
      ]);
    } catch (err) {
      console.error('Slack approval notification failed:', err);
    }
  }

  // Email
  if (workspace.notificationEmails) {
    try {
      const recipients: string[] = JSON.parse(workspace.notificationEmails);
      if (recipients.length > 0) {
        await sendNotificationEmail({
          to: recipients,
          subject: `[${workspace.name}] ${actionLabel[params.action]} — ${params.campaignName}`,
          html: buildApprovalEmailHtml({ workspace, params, actionLabel, campaignUrl }),
        });
      }
    } catch (err) {
      console.error('Email approval notification failed:', err);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Putting workspace ownership check in middleware only:** Middleware sets headers but `getPortalSession()` must also be called in API routes to get the workspaceSlug for ownership comparison. Never skip the `campaign.workspaceSlug !== session.workspaceSlug` check.
- **Cascading approval state:** Do NOT reset `contentApproved` when leads are rejected (or vice versa). These are fully independent per PORTAL-06.
- **Triggering deploy in Phase 9:** When status transitions to 'approved', log it and return — Phase 10 handles the actual deploy. A future Phase 10 hook will watch for `status === 'approved'` transitions. This phase just sets the status.
- **Sorting leads in JS only for large lists:** If a TargetList has thousands of people, fetching all and sorting in-memory is fine for 50-row preview, but the sort should happen in-memory after the query (Prisma can't sort across a relation's field). This is acceptable for the portal preview use case.
- **Resolving spintax with a complex recursive parser:** Spintax in this codebase is flat `{A|B|C}` — a single regex pass is sufficient. Nested spintax is not a use case here.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session verification | Custom cookie parser | `getPortalSession()` already exists in `src/lib/portal-session.ts` | Handles HMAC verify + expiry + throws on failure |
| Workspace ownership check | Re-implement session logic | Call `getPortalSession()` first, compare to campaign.workspaceSlug | Two lines of code |
| Slack block message | Custom Slack HTTP client | `postMessage()` in `src/lib/slack.ts` | Already handles client init, null-safe, accepts KnownBlock[] |
| Email sending | Direct Resend API calls | `sendNotificationEmail()` in `src/lib/resend.ts` | Already handles API key, from address, null-safe |
| Accordion UI | Custom CSS/JS accordion | shadcn `Tabs` or a simple `useState` toggler in a client component | Tabs already installed; if accordion preferred, implement with simple `useState<number | null>` |
| Campaign CRUD | Direct Prisma in route handlers | `getCampaign()`, `listCampaigns()` in `src/lib/campaigns/operations.ts` | Existing operations layer — add new approval functions here |

**Key insight:** This phase is mostly wiring — the hard infrastructure (auth, DB schema, Slack, email, campaign ops) is already built in Phases 7-8. The main new code is UI components, four action API routes, and `notifyApproval()`.

## Common Pitfalls

### Pitfall 1: approvalsSlackChannelId Not in Schema
**What goes wrong:** CONTEXT.md decided notifications go to a "dedicated approvals channel" separate from the workspace reply channel. The Workspace model currently only has `slackChannelId` (for reply notifications). If Phase 9 builds `notifyApproval()` to call `workspace.slackChannelId`, approvals and reply notifications mix in the same channel.
**Why it happens:** Forgetting the schema needs a new field for the dedicated channel.
**How to avoid:** Add `approvalsSlackChannelId String?` and `approvalsSlackChannelName String?` to the Workspace model in schema.prisma. Run `prisma migrate`. `notifyApproval()` uses `workspace.approvalsSlackChannelId ?? workspace.slackChannelId` as fallback.
**Warning signs:** All approval notifications appearing in the same Slack channel as reply notifications.

### Pitfall 2: ICP Score Scope — Wrong PersonWorkspace Row
**What goes wrong:** ICP score is stored on `PersonWorkspace` (workspace-specific), not `Person`. If you query `PersonWorkspace` without filtering by `workspace === workspaceSlug`, you might get the score from the wrong workspace (person could be in multiple workspaces with different scores).
**Why it happens:** Forgetting to add `where: { workspace: workspaceSlug }` on the `workspaces` include.
**How to avoid:** In `getCampaignLeadSample()`, always filter: `workspaces: { where: { workspace: workspaceSlug } }`.
**Warning signs:** Leads showing wrong ICP scores, or scores from a different client's workspace.

### Pitfall 3: Dual-Approval Race Condition on Status Transition
**What goes wrong:** If both leads and content are approved within milliseconds of each other (highly unlikely in practice but possible), two simultaneous writes could both read the current state as "not yet dual-approved" and each independently set fields without the other's update being visible.
**Why it happens:** Read-then-write pattern without a transaction.
**How to avoid:** Use a single `prisma.campaign.update()` call that sets the approval field and conditionally sets `status: 'approved'` in one atomic write. The conditional is: "if the OTHER field is already true in the DB at time of write." Implement as: fetch current state immediately before update in the same function, then update in one call. For Phase 9 scale (low concurrent users), this is sufficient without a full transaction.
**Warning signs:** Campaign stuck in `pending_approval` after both approvals, or status set to `approved` prematurely.

### Pitfall 4: Client Component vs Server Component Split for Approval Buttons
**What goes wrong:** Approve/Reject buttons need `onClick` handlers (client-side interaction), but the campaign detail page needs server-side data fetching with `getPortalSession()`. Mixing these in one component causes RSC errors.
**Why it happens:** Trying to make the whole campaign detail page a client component, losing server-side session security.
**How to avoid:** Follow the existing portal pattern (see `portal/linkedin/page.tsx` and `portal/page.tsx`): the page itself is a server component that fetches data. Pass data as props to client child components (`CampaignApprovalLeads`, `CampaignApprovalContent`) that handle the interactive approval/rejection UI. The client components call the API routes via `fetch`.
**Warning signs:** `"use client"` at the top of the page that calls `getPortalSession()` — that's wrong.

### Pitfall 5: Spintax and Merge Token Order
**What goes wrong:** Running merge token substitution before spintax resolution could accidentally substitute tokens inside a spintax option that wasn't selected (polluting preview text).
**Why it happens:** Running `substituteTokens` before `resolveSpintax`.
**How to avoid:** Always resolve spintax first, then substitute tokens. The pipeline is: raw → `resolveSpintax()` → `substituteTokens()` → rendered preview.
**Warning signs:** Preview showing substituted text inside unrendered `{A|B|C}` blocks.

### Pitfall 6: Portal middleware allows /api/portal/campaigns/* but admin routes don't
**What goes wrong:** The middleware has `PUBLIC_API_PREFIXES` including `/api/portal/` — this means ALL `/api/portal/*` routes bypass admin auth. New `/api/portal/campaigns/*` routes will follow the same allowlist pattern and not need admin auth. But if mistakenly placed outside `/api/portal/`, they'll require admin session.
**Why it happens:** Placing routes at `/api/campaigns/` instead of `/api/portal/campaigns/`.
**How to avoid:** All new client-facing portal API routes MUST be under `/api/portal/campaigns/` to be portal-session-authenticated (not admin-auth). The portal API routes do their own auth via `getPortalSession()`.

## Code Examples

### Campaign List Page — Pending Badge
```typescript
// Notification badge count for the nav
const pendingCount = campaigns.filter(
  c => c.status === 'pending_approval' && (!c.leadsApproved || !c.contentApproved)
).length;

// In PortalNav, pass pendingCount as prop to show badge
```

### Campaign Card — Approval Indicators
```tsx
// Two small indicators per card
<div className="flex items-center gap-2 mt-2">
  <span className={cn(
    "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
    campaign.leadsApproved
      ? "bg-emerald-100 text-emerald-800"
      : "bg-amber-100 text-amber-800"
  )}>
    {campaign.leadsApproved ? "Leads: Approved" : "Leads: Pending"}
  </span>
  <span className={cn(
    "inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
    campaign.contentApproved
      ? "bg-emerald-100 text-emerald-800"
      : "bg-amber-100 text-amber-800"
  )}>
    {campaign.contentApproved ? "Content: Approved" : "Content: Pending"}
  </span>
</div>
```

### Request Changes UX Pattern (Client Component)
```tsx
"use client";
// Shows textarea on "Request Changes" click, hides on "Approve"
const [showFeedback, setShowFeedback] = useState(false);
const [feedback, setFeedback] = useState("");
const [pending, setPending] = useState(false);

async function handleRequestChanges() {
  if (!feedback.trim()) return;
  setPending(true);
  await fetch(`/api/portal/campaigns/${campaignId}/request-changes-leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback }),
  });
  setPending(false);
  router.refresh();
}
```

### Content Email Step Accordion (Client Component)
```tsx
"use client";
const [openStep, setOpenStep] = useState<number>(0); // First step open by default

{emailSteps.map((step, idx) => (
  <div key={idx} className="border rounded-lg">
    <button
      onClick={() => setOpenStep(openStep === idx ? -1 : idx)}
      className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer"
    >
      <span className="font-medium">
        Step {step.position} (Day {step.delayDays})
      </span>
      <ChevronDown className={cn("h-4 w-4 transition-transform", openStep === idx && "rotate-180")} />
    </button>
    {openStep === idx && (
      <div className="px-4 pb-4 space-y-3">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Subject</p>
          <p className="font-medium">{renderContentPreview(step.subjectLine)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Body</p>
          <p className="whitespace-pre-wrap text-sm">{renderContentPreview(step.body)}</p>
        </div>
      </div>
    )}
  </div>
))}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Server-side rendered portal pages | Next.js App Router server components | Phase 7-8 | getPortalSession() works in server components via next/headers cookies() |
| Separate email draft rows (EmailDraft model) | JSON String columns on Campaign (emailSequence, linkedinSequence) | Phase 8 decision | Content preview reads Campaign.emailSequence directly — no separate query needed |
| Reply notifications only | Reply + approval notifications | Phase 9 (this phase) | New notifyApproval() function extends notifications.ts |

**Deprecated/outdated:**
- EmailDraft model rows: Phase 8 decided sequences are stored as JSON on Campaign, not as EmailDraft rows. EmailDraft model still exists in schema but is not used for campaigns created via the agent. Portal should read Campaign.emailSequence/linkedinSequence only.

## Open Questions

1. **Dedicated approvals Slack channel — who creates it?**
   - What we know: The context says notifications go to a "dedicated approvals channel" not the workspace reply channel. The Workspace model currently only has `slackChannelId` (the reply channel). An `approvalsSlackChannelId` field needs to be added to Workspace.
   - What's unclear: Is the approvals channel created as part of Phase 9 workspace setup, or is it assumed to be manually configured by admin? The existing workspace setup flow uses `createPrivateChannel()` from slack.ts.
   - Recommendation: Add `approvalsSlackChannelId String?` to Workspace schema as an optional field. The Phase 9 notification function falls back to `slackChannelId` if `approvalsSlackChannelId` is null. Admin can set the field manually (or via a future workspace settings UI). This keeps Phase 9 scope contained.

2. **Campaign link URL in admin notifications**
   - What we know: The Slack notification has a "View Campaign" button. The client portal URL would be `portal.outsignal.ai/campaigns/[id]`. The admin dashboard URL would be `admin.outsignal.ai/campaigns/[id]` (if that admin view exists).
   - What's unclear: Does an admin campaign detail view exist at /campaigns/[id] in the (admin) route group? Phase 8 built the campaign agent but may not have built admin campaign pages.
   - Recommendation: Use `https://admin.outsignal.ai/campaigns/${campaignId}` in notifications as the deep link. If the admin campaign page doesn't exist yet, the link still points to the right URL that Phase 10 or beyond will build. Acceptable for now.

3. **Lead count in portal vs actual TargetList size**
   - What we know: Portal shows top 50 leads by ICP score. TargetList can have many more.
   - What's unclear: Should the portal show "Showing top 50 of 1,247 leads" to set expectations?
   - Recommendation: Yes — fetch total count alongside the 50-row sample. Show "Showing top 50 of [N] leads, ordered by ICP score" above the table. This is a one-line addition to the query.

## Sources

### Primary (HIGH confidence)
- Codebase: `/Users/jjay/programs/outsignal-agents/src/lib/portal-auth.ts` — HMAC-signed session, PortalSession type
- Codebase: `/Users/jjay/programs/outsignal-agents/src/lib/portal-session.ts` — getPortalSession() pattern
- Codebase: `/Users/jjay/programs/outsignal-agents/src/middleware.ts` — portal routing, PUBLIC_API_PREFIXES
- Codebase: `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — Campaign, Workspace, TargetListPerson, PersonWorkspace schemas
- Codebase: `/Users/jjay/programs/outsignal-agents/src/lib/campaigns/operations.ts` — Campaign ops pattern, VALID_TRANSITIONS, formatCampaignDetail
- Codebase: `/Users/jjay/programs/outsignal-agents/src/lib/notifications.ts` — notifyReply() pattern for Slack + email
- Codebase: `/Users/jjay/programs/outsignal-agents/src/lib/slack.ts` — postMessage() signature
- Codebase: `/Users/jjay/programs/outsignal-agents/src/lib/resend.ts` — sendNotificationEmail() signature
- Codebase: `/Users/jjay/programs/outsignal-agents/src/app/(portal)/portal/page.tsx` — server component with getPortalSession() + Prisma queries
- Codebase: `/Users/jjay/programs/outsignal-agents/src/app/(portal)/layout.tsx` — portal layout, PortalNav usage
- Codebase: `/Users/jjay/programs/outsignal-agents/src/components/portal/portal-nav.tsx` — nav structure to extend

### Secondary (MEDIUM confidence)
- UI component inventory: `src/components/ui/` — confirmed: Card, Badge, Table, Tabs, Textarea, Button, Skeleton available; Accordion not listed

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed and in use
- Architecture: HIGH — follows established patterns from existing portal pages and operations layer
- Pitfalls: HIGH — sourced directly from codebase structure and schema inspection
- Open questions: MEDIUM — inferred from what's missing in schema; requires planner to make a call on approvals channel field

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable codebase, no fast-moving external dependencies)
