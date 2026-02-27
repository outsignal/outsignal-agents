# Architecture Research

**Domain:** Outbound Pipeline v1.1 — Leads Agent Dashboard + Client Portal Review + Smart Campaign Deploy
**Researched:** 2026-02-27
**Confidence:** HIGH (based on direct codebase inspection of all relevant files)

---

## Existing Architecture (What We're Building On)

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENTS (browsers)                                              │
│  admin.outsignal.ai              portal.outsignal.ai            │
└────────────┬─────────────────────────────┬───────────────────────┘
             │                             │ (middleware rewrites)
             ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router                                           │
│  ┌──────────────────────┐   ┌─────────────────────────────────┐ │
│  │  (admin) route group │   │  (portal) route group           │ │
│  │  AppShell + sidebar  │   │  /portal/* server components    │ │
│  │  Cmd+J chat overlay  │   │  Auth: portal_session cookie    │ │
│  │  Auth: admin cookie  │   │  Pages: /, /linkedin            │ │
│  └──────────┬───────────┘   └─────────────────────────────────┘ │
│             │                                                    │
│  ┌──────────▼──────────────────────────────────────────────────┐│
│  │  POST /api/chat → orchestrator.ts (Sonnet 4, 12 steps)     ││
│  │  delegateToResearch ✓  delegateToWriter ✓                   ││
│  │  delegateToLeads ✗ (stub)  delegateToCampaign ✗ (stub)     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Agent Runners — src/lib/agents/                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────┐  ┌───────┐  │
│  │ research.ts   │  │ writer.ts     │  │leads.ts  │  │campaign│ │
│  │ Opus 4, 8 steps│  │ Opus 4, 10 steps│  │(stub)  │  │(stub) │ │
│  └───────────────┘  └───────────────┘  └──────────┘  └───────┘  │
│                                                                  │
│  runner.ts — AgentRun audit trail, generateText wrapper          │
└─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Data Layer — PostgreSQL (Neon) via Prisma 6                     │
│  Person, Company, TargetList, TargetListPerson                   │
│  EmailDraft (status: draft|review|approved|deployed)             │
│  AgentRun, WebsiteAnalysis, KnowledgeDocument                    │
└─────────────────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│  External Services                                               │
│  EmailBison API (app.outsignal.ai/api) — EmailBisonClient        │
│    createCampaign, duplicateCampaign, createLead                 │
│    getSequenceSteps, ensureCustomVariables                       │
│  Enrichment: Prospeo → AI Ark → LeadMagic → FindyMail waterfall  │
│  Firecrawl (website crawl/scrape/ICP scoring)                    │
│  Anthropic API (Opus 4, Sonnet 4, Haiku)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## System Overview After v1.1

```
┌─────────────────────────────────────────────────────────────────┐
│  ADMIN DASHBOARD (Cmd+J chat)                                    │
│                                                                  │
│  "Find 50 SaaS leads for Rise, write copy, deploy campaign"      │
│      ↓                                                           │
│  Orchestrator → delegateToLeads → Leads Agent                    │
│    searchPeople → enrichPerson → scorePerson → addToList         │
│    Creates: TargetList (status: building → pending_review)       │
│      ↓                                                           │
│  Orchestrator → delegateToWriter → Writer Agent                  │
│    Generates: EmailDraft[] (status: draft → review)             │
│      ↓                                                           │
│  Admin promotes list to pending_review + drafts to review        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT PORTAL (portal.outsignal.ai)                             │
│                                                                  │
│  /portal/review/leads — shows TargetList sample + enrichment     │
│    Client: [Approve] or [Request Changes]                        │
│    → POST /api/portal/review/leads/[id]/approve                  │
│    → TargetList.status = 'approved'                              │
│                                                                  │
│  /portal/review/copy — shows EmailDraft[] in 'review' status     │
│    Client: [Approve] or [Request Changes]                        │
│    → POST /api/portal/review/copy/[name]/approve                 │
│    → EmailDraft[].status = 'approved'                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │ (both approved)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAMPAIGN DEPLOY SERVICE                                         │
│  src/lib/campaign-deploy/deploy.ts                               │
│                                                                  │
│  1. Verify approvals (or admin bypass)                           │
│  2. EmailBisonClient.createCampaign()                            │
│  3. EmailBisonClient.addSequenceStep() per EmailDraft            │
│  4. EmailBisonClient.createLead() per verified person            │
│  5. EmailBisonClient.assignLeadToCampaign() per lead             │
│  6. Update: TargetList.status = 'deployed'                       │
│  7. Update: EmailDraft[].status = 'deployed'                     │
│  8. Log: AgentRun { agent: 'campaign-deploy', ... }              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Map: New vs Modified

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| `leads.ts` | **NEW** | `src/lib/agents/leads.ts` | Full Leads Agent: search, enrich, score, list ops |
| `campaign-deploy/deploy.ts` | **NEW** | `src/lib/campaign-deploy/deploy.ts` | Deploy orchestration service |
| `campaign-deploy/sequence-builder.ts` | **NEW** | `src/lib/campaign-deploy/sequence-builder.ts` | EmailDraft → EB sequence step converter |
| `/portal/review/leads/page.tsx` | **NEW** | `src/app/(portal)/portal/review/leads/page.tsx` | Read-only lead list preview |
| `/portal/review/copy/page.tsx` | **NEW** | `src/app/(portal)/portal/review/copy/page.tsx` | Read-only draft copy preview |
| `/api/portal/review/leads/[id]/approve` | **NEW** | `src/app/api/portal/review/leads/[id]/approve/route.ts` | Portal approval endpoint |
| `/api/portal/review/leads/[id]/reject` | **NEW** | `src/app/api/portal/review/leads/[id]/reject/route.ts` | Portal reject with feedback |
| `/api/portal/review/copy/[name]/approve` | **NEW** | `src/app/api/portal/review/copy/[name]/approve/route.ts` | Copy approval endpoint |
| `/api/portal/review/copy/[name]/reject` | **NEW** | `src/app/api/portal/review/copy/[name]/reject/route.ts` | Copy reject with feedback |
| `/api/lists/[id]/deploy` | **NEW** | `src/app/api/lists/[id]/deploy/route.ts` | Admin-triggered manual deploy |
| `EmailBisonClient` | **MODIFY** | `src/lib/emailbison/client.ts` | Add `addSequenceStep()`, `assignLeadToCampaign()` |
| `orchestrator.ts` | **MODIFY** | `src/lib/agents/orchestrator.ts` | Wire stubs to real `runLeadsAgent()` / `runCampaignAgent()` |
| `types.ts` | **MODIFY** | `src/lib/agents/types.ts` | Extend LeadsInput/Output if needed (already skeleton-typed) |
| `portal/layout.tsx` | **MODIFY** | `src/app/(portal)/layout.tsx` | Add "Review" nav link |
| `schema.prisma` | **MODIFY** | `prisma/schema.prisma` | Add `status` field to `TargetList` |
| `middleware.ts` | **NO CHANGE** | `src/middleware.ts` | `/api/portal/` already in PUBLIC_API_PREFIXES |

---

## Detailed Integration Points

### 1. Leads Agent Runner

**What changes where:**

The `delegateToLeads` tool in `orchestrator.ts` is currently a stub returning `{ status: "not_available" }`. Replace the `execute` function body with a call to `runLeadsAgent()`, following the exact pattern used by `delegateToResearch`:

```typescript
// orchestrator.ts — current stub execute:
execute: async () => {
  return { status: "not_available", message: "..." };
}

// Replace with:
execute: async ({ workspaceSlug, task, limit }) => {
  try {
    const result = await runLeadsAgent({ workspaceSlug, task, limit });
    return { status: "complete", ...result };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Leads Agent failed" };
  }
}
```

**Tools the Leads Agent needs** (operate on existing Prisma models — zero schema changes needed for Phase 1):

```
searchPeople(query, filters)      → Person[] from local DB (14k+ dataset)
enrichPerson(email)               → trigger waterfall enrichment via existing /api/people/enrich logic
scorePerson(personId, workspaceSlug) → ICP score using existing scorer
createList(name, workspaceSlug)   → TargetList.create()
addToList(listId, personIds[])    → TargetListPerson.createMany()
getList(listId)                   → TargetList with members + enrichment summary
```

All these tools touch models that already exist. The agent produces `TargetList` + `TargetListPerson` records — the same data the v1.0 UI list builder creates.

### 2. Schema Change (TargetList Status)

`TargetList` needs a `status` field to track the portal review lifecycle:

```prisma
model TargetList {
  id            String   @id @default(cuid())
  name          String
  workspaceSlug String
  description   String?
  status        String   @default("building")
  // building | pending_review | approved | rejected | deployed
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  people TargetListPerson[]
  @@index([workspaceSlug])
}
```

`EmailDraft.status` already has the correct values (`draft | review | approved | deployed`). No schema change needed there — the Writer Agent saves drafts in `draft` status; admin promotes them to `review` manually before exposing to portal.

### 3. Portal Review Pages

Both pages are read-only server components. They use `getPortalSession()` to scope to the workspace — same pattern as the existing `/portal/page.tsx`:

```typescript
// /portal/review/leads/page.tsx — structure
export default async function LeadsReviewPage() {
  const { workspaceSlug } = await getPortalSession();

  // Find the pending_review list for this workspace
  const list = await prisma.targetList.findFirst({
    where: { workspaceSlug, status: "pending_review" },
    include: { people: { include: { person: true }, take: 100 } },
    orderBy: { updatedAt: "desc" },
  });

  // Render sample: company, title, name (no email shown to client)
  // Approve/Reject buttons fire POST to /api/portal/review/leads/[id]/approve
}
```

Client sees: list name, count, sample rows (company + title + name), enrichment summary (% with email, LinkedIn, etc.). No email addresses shown — client is approving the targeting, not the data.

### 4. Portal Approval API Routes

These live under `/api/portal/` which is already in `PUBLIC_API_PREFIXES` in middleware (passes through without admin auth). The route handlers verify the portal session themselves:

```typescript
// /api/portal/review/leads/[id]/approve/route.ts
export async function POST(_req: Request, context: RouteContext) {
  const { workspaceSlug } = await getPortalSession();  // throws → 500 if no session
  const { id } = await context.params;

  const list = await prisma.targetList.findUnique({ where: { id } });
  // Ownership check — critical security boundary
  if (!list || list.workspaceSlug !== workspaceSlug) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.targetList.update({ where: { id }, data: { status: "approved" } });

  // Check if copy is also approved — trigger deploy if so
  const approvedDrafts = await prisma.emailDraft.count({
    where: { workspaceSlug, status: "approved" }
  });
  if (approvedDrafts > 0) {
    // Fire-and-forget — don't block the response
    void deployCampaign(workspaceSlug, id);
  }

  return NextResponse.json({ ok: true });
}
```

### 5. EmailBisonClient Extensions

Two methods need to be added to `src/lib/emailbison/client.ts`. The client's `request<T>()` pattern is well-established — these follow the exact same shape:

```typescript
// Add to EmailBisonClient:

async addSequenceStep(campaignId: number, step: {
  subject?: string;
  body: string;
  delay_days: number;
  position: number;
}): Promise<SequenceStep> {
  const res = await this.request<{ data: SequenceStep }>(
    `/campaigns/sequence-steps`,
    {
      method: 'POST',
      body: JSON.stringify({ campaign_id: campaignId, ...step }),
      revalidate: 0,
    }
  );
  return res.data;
}

async assignLeadToCampaign(campaignId: number, leadId: number): Promise<void> {
  await this.request<unknown>(
    `/campaigns/${campaignId}/leads`,
    {
      method: 'POST',
      body: JSON.stringify({ lead_id: leadId }),
      revalidate: 0,
    }
  );
}
```

Note: The EmailBison API for `addSequenceStep` and `assignLeadToCampaign` endpoint shapes are MEDIUM confidence — they follow common REST patterns but should be verified against the EmailBison API docs during implementation. The existing `createCampaign` and `createLead` methods provide the pattern to follow.

### 6. Deploy Service

```typescript
// src/lib/campaign-deploy/deploy.ts
export async function deployCampaign(
  workspaceSlug: string,
  listId: string,
  campaignNameOverride?: string
): Promise<void> {
  // 1. Load list + people (verified email only)
  const list = await prisma.targetList.findUnique({
    where: { id: listId },
    include: { people: { include: { person: true } } },
  });

  // 2. Load approved drafts for workspace
  const drafts = await prisma.emailDraft.findMany({
    where: { workspaceSlug, status: "approved" },
    orderBy: [{ campaignName: "asc" }, { sequenceStep: "asc" }],
  });

  // Group drafts by campaign name — deploy one campaign per unique name
  const campaignGroups = groupBy(drafts, d => d.campaignName);

  for (const [campaignName, steps] of Object.entries(campaignGroups)) {
    const client = await getClientForWorkspace(workspaceSlug);

    // 3. Create campaign in EmailBison
    const campaign = await client.createCampaign({ name: campaignName });

    // 4. Add sequence steps
    for (const draft of steps) {
      await client.addSequenceStep(campaign.id, {
        subject: draft.subjectLine ?? undefined,
        body: draft.bodyText,
        delay_days: draft.delayDays,
        position: draft.sequenceStep,
      });
    }

    // 5. Add leads (email verified only — hard gate)
    for (const tlp of list.people) {
      if (!tlp.person.email) continue; // skip unverified
      const lead = await client.createLead({
        email: tlp.person.email,
        firstName: tlp.person.firstName ?? undefined,
        lastName: tlp.person.lastName ?? undefined,
        jobTitle: tlp.person.jobTitle ?? undefined,
        company: tlp.person.company ?? undefined,
      });
      await client.assignLeadToCampaign(campaign.id, lead.id);
    }

    // 6. Update draft statuses
    await prisma.emailDraft.updateMany({
      where: { workspaceSlug, campaignName, status: "approved" },
      data: { status: "deployed" },
    });
  }

  // 7. Update list status
  await prisma.targetList.update({
    where: { id: listId },
    data: { status: "deployed" },
  });
}
```

---

## Data Flows

### Admin Pipeline (Cmd+J Chat → Approved List + Copy)

```
User: "Find 50 UK SaaS leads for Rise and write 3-step email sequence"
    ↓
POST /api/chat (streamText, orchestrator, 12 steps)
    ↓
delegateToLeads { workspaceSlug: "rise", task: "...", limit: 50 }
    ↓
runLeadsAgent() → runner.ts creates AgentRun { agent: "leads" }
    ↓
Leads Agent tools: searchPeople → enrichPerson → scorePerson → createList → addToList
    ↓
TargetList { status: "building" } + TargetListPerson[] created in DB
    ↓
delegateToWriter { workspaceSlug: "rise", task: "3-step email for SaaS leads" }
    ↓
runWriterAgent() → runner.ts creates AgentRun { agent: "writer" }
    ↓
Writer Agent: getWorkspaceIntelligence → searchKnowledgeBase → saveDraft × 3
    ↓
EmailDraft[] { status: "draft" } created in DB
    ↓
Admin: PATCH /api/lists/[id] sets TargetList.status → "pending_review"
Admin: PATCH /api/drafts sets EmailDraft[].status → "review"
```

### Client Portal Approval Flow

```
Client visits portal.outsignal.ai
    ↓ middleware rewrites → /portal/*
portal_session cookie → getPortalSession() → { workspaceSlug }
    ↓
/portal/review/leads — server component fetches TargetList { status: "pending_review" }
Shows: list name, count, sample rows (company + title + name), enrichment summary
    ↓
[Approve] → POST /api/portal/review/leads/[id]/approve
  → verify list.workspaceSlug === session.workspaceSlug (ownership check)
  → TargetList.status = "approved"
  → if EmailDraft.status === "approved" exists → void deployCampaign()
    ↓
/portal/review/copy — server component fetches EmailDraft[] { status: "review" }
Shows: campaign name, step 1/2/3 subject + body (read-only)
    ↓
[Approve] → POST /api/portal/review/copy/[campaignName]/approve
  → verify drafts.workspaceSlug === session.workspaceSlug
  → EmailDraft[].status = "approved"
  → if TargetList.status === "approved" exists → void deployCampaign()
```

### Deploy Flow

```
deployCampaign(workspaceSlug, listId)
    ↓
Load TargetList + people (email verified only)
Load EmailDraft[] { status: "approved", workspaceSlug }
    ↓
Group drafts by campaignName
    ↓
For each campaign group:
  EmailBisonClient.createCampaign({ name, type: "outbound" })
    → returns { id: campaignId }
      ↓
  For each EmailDraft (sorted by sequenceStep):
    EmailBisonClient.addSequenceStep(campaignId, { subject, body, delay_days })
      ↓
  For each TargetListPerson (email verified only):
    EmailBisonClient.createLead(person) → returns { id: leadId }
    EmailBisonClient.assignLeadToCampaign(campaignId, leadId)
      ↓
prisma.emailDraft.updateMany → status: "deployed"
prisma.targetList.update → status: "deployed"
AgentRun.create { agent: "campaign-deploy", triggeredBy: "portal-approval" }
```

---

## Build Order (Dependency-Driven)

Dependencies flow left-to-right: each phase unblocks the next.

```
Phase 1          Phase 2          Phase 3          Phase 4
Leads Agent  →   Schema +     →   Portal Review →  Deploy Service
(no deps)        Promotion UI     Pages + APIs     + EB Client ext.
                 (needs schema)   (needs schema,   (needs approved
                                  portal auth)     list + copy)
```

### Phase 1: Leads Agent Runner

**Files:** `src/lib/agents/leads.ts` (new), `src/lib/agents/orchestrator.ts` (modify wire stub)

**Why first:** No external dependencies. Produces the TargetList data that everything else consumes. Can be tested via Cmd+J chat immediately. The orchestrator stub is already wired — just replace the execute body.

**Test:** Open Cmd+J, say "Find 20 SaaS companies in the UK for Rise and create a list called 'UK SaaS Jan'"

### Phase 2: Schema Migration + Admin Promotion UI

**Files:** `prisma/schema.prisma` (add TargetList.status), `src/app/(admin)/lists/[id]/page.tsx` (add promote buttons)

**Why second:** Portal review pages can't function without TargetList.status. Admin promotion UI lets you move lists from `building` → `pending_review` and drafts from `draft` → `review`. Must exist before Phase 3 can be tested.

**Action:** `npx prisma db push` after schema change (consistent with existing db push approach per PROJECT.md)

### Phase 3: Client Portal Review Pages + APIs

**Files:**
- `src/app/(portal)/portal/review/leads/page.tsx` (new)
- `src/app/(portal)/portal/review/copy/page.tsx` (new)
- `src/app/api/portal/review/leads/[id]/approve/route.ts` (new)
- `src/app/api/portal/review/leads/[id]/reject/route.ts` (new)
- `src/app/api/portal/review/copy/[name]/approve/route.ts` (new)
- `src/app/api/portal/review/copy/[name]/reject/route.ts` (new)
- `src/app/(portal)/layout.tsx` (modify: add "Review" nav link)

**Why third:** Needs Phase 2 schema for status field. Portal pages are simple server components — no complex state, just DB reads + button actions. Deploy is fire-and-forget in the approval handlers (Phase 4 delivers it, but approval endpoints can stub the call for now).

### Phase 4: EmailBisonClient Extensions + Deploy Service

**Files:**
- `src/lib/emailbison/client.ts` (modify: add addSequenceStep, assignLeadToCampaign)
- `src/lib/campaign-deploy/deploy.ts` (new)
- `src/lib/campaign-deploy/sequence-builder.ts` (new)
- `src/app/api/lists/[id]/deploy/route.ts` (new: admin manual deploy)
- Wire deploy into portal approval handlers from Phase 3

**Why fourth:** Deploy requires approved data from Phases 2+3. Also requires EmailBisonClient extensions — these are new HTTP endpoints and their exact shape needs verification against EmailBison API docs before writing.

### Phase 5: Campaign Agent Runner (Optional Enhancement)

**Files:** `src/lib/agents/campaign.ts` (new), `orchestrator.ts` (modify wire delegateToCampaign)

**Why last:** The full pipeline works without it (deploy can be triggered via portal approval or admin button). Campaign Agent is a convenience layer for chat-driven deployment. Low priority, high effort.

---

## Architectural Patterns to Follow

### Pattern: Agent Runner Convention

All agents follow the exact same shape. leads.ts must match research.ts and writer.ts:

```typescript
const leadsConfig: AgentConfig = {
  name: "leads",
  model: "claude-opus-4-20250514",  // Opus — complex reasoning, multi-tool chains
  systemPrompt: LEADS_SYSTEM_PROMPT,
  tools: leadsTools,
  maxSteps: 15,  // Higher than research/writer — enrichment = many tool calls
};

export async function runLeadsAgent(input: LeadsInput): Promise<LeadsOutput> {
  const result = await runAgent<LeadsOutput>(leadsConfig, buildLeadsMessage(input), {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  });
  return result.output;
}
```

The `runAgent()` in `runner.ts` handles: AgentRun create → generateText → steps extraction → AgentRun update. All agents get audit trails for free by using it.

### Pattern: Portal Auth in API Routes

`/api/portal/*` routes are marked as public in middleware (no admin cookie check). The route handlers must verify the portal session and enforce workspace ownership:

```typescript
export async function POST(_req: Request, context: RouteContext) {
  // 1. Verify portal session (throws if none)
  const { workspaceSlug } = await getPortalSession();

  // 2. Load resource and verify ownership
  const { id } = await context.params;
  const list = await prisma.targetList.findUnique({ where: { id } });

  if (!list || list.workspaceSlug !== workspaceSlug) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3. Perform action
  await prisma.targetList.update({ where: { id }, data: { status: "approved" } });

  return NextResponse.json({ ok: true });
}
```

Never trust the ID in the URL without verifying workspace ownership. Client A must never be able to approve Client B's list.

### Pattern: Fire-and-Forget Deploy

Campaign deploy involves many sequential EmailBison API calls (up to 200+ for a full list). This must not block the portal approval response. The Vercel Hobby function timeout is 10s; deploy will take 60-300s for a real list.

```typescript
// In approval route — return immediately, deploy runs async
await prisma.targetList.update({ where: { id }, data: { status: "approved" } });

// Check if copy is ready
const readyCopy = await prisma.emailDraft.count({ where: { workspaceSlug, status: "approved" } });
if (readyCopy > 0) {
  void deployCampaign(workspaceSlug, id);  // fire and forget
}

return NextResponse.json({ ok: true });  // client gets this immediately
```

Deploy status is trackable via AgentRun records (admin can check the runs log). Consider a simple deploy status indicator in the admin list detail page.

### Pattern: Hard Email Verification Gate

Inherited from v1.0 — never send unverified emails to EmailBison. In the deploy service, always filter:

```typescript
const eligiblePeople = list.people.filter(tlp => {
  const p = tlp.person;
  return p.email && p.email.trim() !== '';
  // Additional: could check enrichmentData.emailVerified === true
});
```

This is consistent with the existing CSV export gate in `/api/lists/[id]/export/route.ts`.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Blocking Portal Response on Deploy

**What people do:** Await the full `deployCampaign()` call inside the approval API route.

**Why it's wrong:** A list of 100 people = 100+ EmailBison API calls, sequential. At 100-300ms each, that's 10-30s. Vercel Hobby times out at 10s. Client sees a network error.

**Do this instead:** Return the approval response immediately. Fire deploy with `void deployCampaign()`. Use AgentRun status to expose deploy progress in admin.

### Anti-Pattern 2: Skipping Workspace Ownership Check

**What people do:** Trust the `listId` or `campaignName` in the URL without verifying it belongs to the session's workspace.

**Why it's wrong:** A logged-in portal client could approve another client's leads list by guessing IDs (CUID collision is low but the security principle is wrong either way).

**Do this instead:** Always: `findUnique({ where: { id } })` then `if (list.workspaceSlug !== workspaceSlug) return 404`. Every portal API route follows this pattern.

### Anti-Pattern 3: Overcomplicating Portal UX

**What people do:** Build per-lead approve/reject, inline editing, comment threading on individual copy steps.

**Why it's wrong:** Per-PROJECT.md, portal approval is binary (whole list, whole copy batch). Complexity adds build time and noise. Clients approve the work product, not edit it.

**Do this instead:** Read-only sample view with enrichment summary. Two actions: Approve (whole list) or Request Changes (textarea → stored as feedback on reject). Admin acts on the feedback, re-submits.

### Anti-Pattern 4: Multiple Deploy Triggers Racing

**What people do:** Trigger deploy from both the leads approval and the copy approval without deduplication.

**Why it's wrong:** If both approval routes fire deploy simultaneously, you create two campaigns in EmailBison with the same name and duplicate all the leads.

**Do this instead:** Only one trigger fires deploy. Convention: leads approval triggers deploy if copy is already approved. Copy approval triggers deploy if leads are already approved. Since portal review is sequential (leads first, then copy), the natural order prevents races. If concurrent access is a concern, use a TargetList.status check as a mutex (`deployed` prevents re-deploy).

### Anti-Pattern 5: Embedding EmailBison API Calls Directly in Agent Tools

**What people do:** Put `EmailBisonClient.createCampaign()` calls directly inside the Campaign Agent's tool `execute` functions.

**Why it's wrong:** Deploy logic becomes untestable without an agent context. Can't call deploy from portal approval or admin button without running a full agent.

**Do this instead:** Campaign deploy is a service (`src/lib/campaign-deploy/deploy.ts`) that the Campaign Agent tools call. The agent is a thin wrapper. Same pattern as how Writer Agent calls `prisma.emailDraft.create()` directly — the agent is a driver, not the implementation.

---

## Integration Points Summary

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| EmailBison API | `EmailBisonClient` (existing) | Add `addSequenceStep()` + `assignLeadToCampaign()` — endpoint shapes need verification against EB API docs (MEDIUM confidence) |
| Enrichment providers | Existing waterfall in `EnrichmentJob` / `EnrichmentLog` pattern | Leads Agent tools reuse same logic, called as tool wrappers |
| Anthropic API | `runner.ts` + `generateText()` (existing) | leads.ts uses same pattern — Opus 4, 15 steps |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Chat UI → Orchestrator | POST `/api/chat` (streaming, existing) | No change needed |
| Orchestrator → Leads Agent | `runLeadsAgent()` (replace stub) | Wire in `orchestrator.ts` |
| Orchestrator → Campaign Agent | `runCampaignAgent()` (replace stub) | Phase 5 only |
| Portal → Approval API | POST `/api/portal/review/*/approve` | Session cookie = workspace scope |
| Approval API → Deploy Service | Direct function call, `void` (fire-and-forget) | Don't await |
| Deploy Service → EmailBison | `EmailBisonClient` methods | Rate limit 429 handling already exists in client |
| Admin UI → Deploy | POST `/api/lists/[id]/deploy` | Admin bypass — no approval status check needed |

---

## Scaling Considerations

| Scale | Architecture Notes |
|-------|-------------------|
| Current (6 workspaces, 50-200 leads/campaign) | Sequential deploy in-process is fine. Fire-and-forget with Vercel background processing. |
| 20+ workspaces, 500+ leads/campaign | Sequential deploy will hit Vercel function timeouts. Adopt `EnrichmentJob` queue pattern — already exists in schema, batch by 50 leads per job chunk. |
| 50+ concurrent deploys | Deploy needs background worker (Railway or Vercel Cron chunking). `EnrichmentJob` model + `resumeAt` field already supports this pattern — reuse for `CampaignDeployJob`. |

The `EnrichmentJob` model (with `chunkSize`, `processedCount`, `resumeAt`) is the right template for scaling campaign deploy if sequential in-process stops working.

---

## Sources

- `src/lib/agents/orchestrator.ts` — current delegation stubs, tool shapes (HIGH)
- `src/lib/agents/runner.ts` — AgentRun pattern all agents must follow (HIGH)
- `src/lib/agents/research.ts`, `writer.ts`, `types.ts` — established agent conventions (HIGH)
- `src/lib/emailbison/client.ts` — existing EmailBison API capabilities + what's missing (HIGH)
- `prisma/schema.prisma` — full data model including TargetList, EmailDraft, AgentRun (HIGH)
- `src/middleware.ts` — auth boundaries, `/api/portal/` public passthrough (HIGH)
- `src/app/(portal)/portal/page.tsx` — portal server component pattern, getPortalSession() usage (HIGH)
- `src/app/api/lists/[id]/export/route.ts` — email verification gate to replicate in deploy (HIGH)
- `.planning/PROJECT.md` — requirements, constraints, out-of-scope items (HIGH)
- EmailBison sequence step + lead assignment API endpoints — not inspected directly (MEDIUM — verify endpoint shapes during Phase 4)

---

*Architecture research for: Outsignal v1.1 Outbound Pipeline (Leads Agent + Portal Review + Campaign Deploy)*
*Researched: 2026-02-27*
