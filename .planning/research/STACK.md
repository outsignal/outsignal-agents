# Stack Research

**Domain:** Outbound Pipeline v1.1 — Leads Agent Dashboard Integration, Client Portal Review UI, Smart Campaign Deployment
**Researched:** 2026-02-27
**Confidence:** HIGH — all findings verified against live codebase, installed packages at exact versions, and established patterns from v1.0

---

## Key Finding: No New Dependencies Required

The existing stack covers all three new feature areas. Every new capability is an extension of already-installed packages at their current versions. Zero `npm install` calls needed for v1.1.

This is the defining characteristic of this milestone: the work is in **wiring and extending**, not in adding libraries. The codebase already has AI SDK for agent runners, Zod for tool schemas, Prisma for DB, an EmailBison client with campaign/lead creation methods, portal auth middleware with session management, and streaming chat infrastructure. All three features slot into existing seams.

---

## Existing Stack (Installed, Verified)

Exact versions confirmed from `/Users/jjay/programs/outsignal-agents/package.json` and `node_modules/*/package.json`:

| Package | Exact Version | Role in v1.1 |
|---------|--------------|--------------|
| `ai` | 6.0.97 | `streamText` for chat route, `generateText` + `stepCountIs` for agent runner, `tool()` for tool definitions |
| `@ai-sdk/anthropic` | 3.0.46 | Claude model adapter — Opus 4 for Leads Agent (complex reasoning), Sonnet 4 for orchestrator (routing) |
| `@ai-sdk/react` | 3.0.99 | `useChat` hook — dashboard Cmd+J chat, no changes needed |
| `next` | 16.1.6 | App Router pages for portal lead list + content review |
| `prisma` + `@prisma/client` | 6.19.2 | Schema extensions for portal approval state + campaign deploy tracking |
| `zod` | 4.3.6 | Tool input schemas for Leads Agent tools (same pattern as research/writer agents) |
| `nuqs` | 2.8.8 | URL state for portal lead list filters (already used in admin people/companies pages) |
| `radix-ui` | 1.4.3 | UI primitives via shadcn components — existing components cover portal UI needs |
| `lucide-react` | 0.575.0 | Icons — already covers approval UI needs (CheckCircle, XCircle, Clock) |

---

## Feature 1: Leads Agent Dashboard Integration

### What It Is

Wire `src/lib/agents/leads.ts` (a new file) into the orchestrator, replacing the existing `delegateToLeads` stub in `src/lib/agents/orchestrator.ts` (line 61-76) that currently returns `"not_available"`.

### Architecture

The pattern is already proven across two agents. Leads Agent follows the exact same structure as `writer.ts` and `research.ts`:

```typescript
// src/lib/agents/leads.ts
import { tool } from "ai";           // ai@6.0.97 — already installed
import { z } from "zod";             // zod@4.3.6 — already installed
import { runAgent } from "./runner"; // existing generic runner
import type { AgentConfig, LeadsInput, LeadsOutput } from "./types"; // types already defined

const leadsTools = {
  searchPeople: tool({ ... }),       // wraps existing Prisma queries
  enrichPerson: tool({ ... }),       // wraps existing enrichment waterfall
  buildTargetList: tool({ ... }),    // wraps existing TargetList operations
  exportToEmailBison: tool({ ... }), // wraps existing export logic
};

export async function runLeadsAgent(input: LeadsInput): Promise<LeadsOutput> {
  return runAgent<LeadsOutput>(leadsConfig, buildLeadsMessage(input), {
    triggeredBy: "orchestrator",
    workspaceSlug: input.workspaceSlug,
  }).then(r => r.output);
}
```

### Types Already Defined

`LeadsInput` and `LeadsOutput` are already in `src/lib/agents/types.ts` (lines 65-80):

```typescript
export interface LeadsInput {
  workspaceSlug: string;
  task: string;
  limit?: number;
  sources?: string[];
}

export interface LeadsOutput {
  leadsFound: number;
  leadsImported: number;
  leadsEnriched: number;
  duplicatesSkipped: number;
  sourceSummary: Record<string, number>;
  topLeads: { name: string; company: string; score: number }[];
}
```

No type changes needed.

### Orchestrator Integration

`src/lib/agents/orchestrator.ts` already has the delegation tool stub at line 61. The `execute` body (currently returns `{ status: "not_available", message: "..." }`) is replaced with a call to `runLeadsAgent`:

```typescript
// Before (stub)
execute: async () => {
  return { status: "not_available", message: "The Leads Agent is not yet implemented..." };
},

// After (live)
execute: async ({ workspaceSlug, task, limit }) => {
  try {
    const result = await runLeadsAgent({ workspaceSlug, task, limit });
    return { status: "complete", ...result };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : "Leads Agent failed" };
  }
},
```

### Model Selection

Use `claude-opus-4-20250514` for the Leads Agent. Leads operations (multi-step search, enrich-if-needed, score, list-build) involve sequential decision-making across tool calls that benefits from Opus-level reasoning. Sonnet is reserved for the orchestrator (routing/dispatching only).

Both model IDs are already in the `AgentConfig.model` union type in `types.ts` (line 8).

### Files for Feature 1

| File | Action | What Changes |
|------|--------|-------------|
| `src/lib/agents/leads.ts` | CREATE | New agent — leadsTools, leadsConfig, runLeadsAgent(), buildLeadsMessage() |
| `src/lib/agents/orchestrator.ts` | MODIFY | Replace stub execute body; add `runLeadsAgent` import |
| `src/lib/agents/types.ts` | NO CHANGE | LeadsInput + LeadsOutput already defined |

---

## Feature 2: Client Portal Lead List + Content Review UI

### What It Is

New pages at `/portal/[workspaceSlug]/leads` and `/portal/[workspaceSlug]/content` that let authenticated portal clients view their ICP lead sample and approve/reject Writer Agent drafts. Binary approval only (whole list or batch, not per-item — confirmed in PROJECT.md out-of-scope).

### Portal Auth Infrastructure (Already Built)

The auth infrastructure is complete. Nothing new needed:

```
middleware.ts         — rewrites portal.outsignal.ai/* to /portal/*, enforces portal session
portal-auth.ts        — JWT verification (Node runtime)
portal-auth-edge.ts   — JWT verification (Edge runtime, used in middleware)
portal-session.ts     — getPortalSession() helper for server components
/api/portal/login     — magic link send
/api/portal/verify    — magic link verify + cookie set
/api/portal/logout    — cookie clear
```

The portal pages (`src/app/portal/`) do not exist yet — that is the gap. The middleware already routes and authenticates. The pages need to be created.

### Portal Page Structure

```
src/app/portal/
  login/
    page.tsx                        — Magic link email entry form (already has /api/portal/login)
  [workspaceSlug]/
    page.tsx                        — Dashboard: links to leads + content
    leads/
      page.tsx                      — ICP lead sample table + approve/reject
    content/
      page.tsx                      — Writer drafts grouped by campaign + approve/reject
```

All pages use `getPortalSession()` to get `workspaceSlug` and scope DB queries.

### Approval State (New Prisma Model)

The `EmailDraft.status` field already has `'approved'` as a valid state (schema line 284: `"draft | review | approved | deployed"`). Content approval updates that field.

For lead list approval, a new `PortalApproval` model is cleaner than adding columns to `TargetList`, because:
- A list can be re-submitted after rejection (creates a new approval record — immutable history)
- We need approver email + timestamp for audit
- Avoids polluting `TargetList` with portal-specific state

```prisma
model PortalApproval {
  id            String   @id @default(cuid())
  workspaceSlug String
  entityType    String   // "leads_list" | "content_batch"
  entityId      String   // TargetList.id for leads_list; campaignName for content_batch
  status        String   @default("pending") // "pending" | "approved" | "rejected"
  approvedBy    String?  // client email from portal session
  feedback      String?  // rejection reason or notes (required on rejection)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug, entityType])
  @@index([entityId])
}
```

### Portal API Routes

All portal API routes validate that `session.workspaceSlug === params.workspaceSlug`. No extra auth layer needed — the middleware already verified the session.

| Route | Method | What It Does |
|-------|--------|-------------|
| `/api/portal/[workspaceSlug]/leads` | GET | Returns ICP-filtered people for this workspace (top 50-100 by icpScore desc) |
| `/api/portal/[workspaceSlug]/drafts` | GET | Returns EmailDraft records grouped by campaignName where status in ['draft','review','approved'] |
| `/api/portal/[workspaceSlug]/approve` | POST | Creates PortalApproval record; on content approval triggers campaign deployment |

### UI Components (All Installed)

The portal UI is simple approval surfaces. No new component library needed:

- `Card`, `Table`, `Badge`, `Button`, `Tabs` — already installed via shadcn/radix-ui
- `CheckCircle2`, `XCircle`, `Clock` — from lucide-react@0.575.0 (already installed)
- `nuqs` — URL state for filter persistence on lead list (already used in admin)

### Files for Feature 2

| File | Action | What Changes |
|------|--------|-------------|
| `src/app/portal/login/page.tsx` | CREATE | Magic link email entry form |
| `src/app/portal/[workspaceSlug]/page.tsx` | CREATE | Portal dashboard (links to leads + content) |
| `src/app/portal/[workspaceSlug]/leads/page.tsx` | CREATE | Lead sample table with approve/reject |
| `src/app/portal/[workspaceSlug]/content/page.tsx` | CREATE | Draft preview grouped by campaign with approve/reject |
| `src/app/api/portal/[workspaceSlug]/leads/route.ts` | CREATE | GET scoped people query |
| `src/app/api/portal/[workspaceSlug]/drafts/route.ts` | CREATE | GET scoped drafts query |
| `src/app/api/portal/[workspaceSlug]/approve/route.ts` | CREATE | POST approval action |
| `prisma/schema.prisma` | MODIFY | Add PortalApproval model |

---

## Feature 3: Smart Campaign Deployment to EmailBison

### What It Is

On portal content approval (or admin trigger), auto-create a new EmailBison campaign, add approved `EmailDraft` sequence steps, and assign leads from an approved `TargetList`.

### What the EmailBison Client Already Has

Verified by reading `src/lib/emailbison/client.ts`:

| Method | Status | What It Does |
|--------|--------|-------------|
| `createCampaign(params)` | EXISTS (line 126) | Creates campaign, returns `{ id, sequence_id }` |
| `duplicateCampaign(templateId)` | EXISTS (line 142) | Clones campaign structure |
| `createLead(params)` | EXISTS (line 150) | Creates lead record in EmailBison |
| `getCustomVariables()` | EXISTS (line 170) | Lists custom variables |
| `createCustomVariable(name)` | EXISTS (line 174) | Creates custom variable |
| `ensureCustomVariables(names[])` | EXISTS (line 183) | Idempotent variable setup |

### What's Missing From EmailBisonClient

Three methods need to be added to `src/lib/emailbison/client.ts`:

**1. Add lead to campaign** — EmailBison API: `POST /campaigns/{campaignId}/leads`

```typescript
async addLeadToCampaign(campaignId: number, leadId: number): Promise<void> {
  await this.request(`/campaigns/${campaignId}/leads`, {
    method: 'POST',
    body: JSON.stringify({ lead_id: leadId }),
    revalidate: 0,
  });
}
```

**2. Create sequence step** — EmailBison API: `POST /campaigns/sequence-steps`

```typescript
async createSequenceStep(params: CreateSequenceStepParams): Promise<SequenceStepCreateResult> {
  const res = await this.request<{ data: SequenceStepCreateResult }>('/campaigns/sequence-steps', {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: params.campaignId,
      subject: params.subject,
      body: params.body,
      delay_days: params.delayDays,
      position: params.position,
    }),
    revalidate: 0,
  });
  return res.data;
}
```

**3. Update sequence step** — EmailBison API: `PATCH /campaigns/sequence-steps/{id}`

```typescript
async updateSequenceStep(stepId: number, params: Partial<CreateSequenceStepParams>): Promise<SequenceStepCreateResult> {
  const res = await this.request<{ data: SequenceStepCreateResult }>(`/campaigns/sequence-steps/${stepId}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
    revalidate: 0,
  });
  return res.data;
}
```

### Type Additions for `src/lib/emailbison/types.ts`

```typescript
export interface CreateSequenceStepParams {
  campaignId: number;
  subject?: string;  // null/undefined for LinkedIn steps
  body: string;
  delayDays: number;
  position: number;
}

export interface SequenceStepCreateResult {
  id: number;
  campaign_id: number;
  position: number;
  subject?: string;
  body?: string;
  delay_days?: number;
}
```

### Deployment Order

Always in this sequence — creating steps before assigning leads ensures leads enter the sequence immediately:

```
1. createCampaign({ name, type: 'outbound', plainText: true })
   → returns { id: campaignId, sequence_id }

2. ensureCustomVariables(['firstName', 'company', 'title', ...])
   → idempotent, safe to call every time

3. For each EmailDraft (ordered by sequenceStep ASC):
   createSequenceStep({ campaignId, subject, body, delayDays, position })
   → marks EmailDraft.status = 'deployed'

4. For each Person in approved TargetList:
   createLead({ email, firstName, lastName, jobTitle, company, ... })
   → returns { id: leadId }
   addLeadToCampaign(campaignId, leadId)
   → sequential, not parallel (rate limit protection)

5. Update CampaignDeploy record to { status: 'complete', leadsDeployed, stepsDeployed }
```

### Rate Limit Handling

The existing `RateLimitError` in the client handles 429s with `retryAfter`. For bulk lead assignment, use sequential processing with `for...of` + `await` — not `Promise.all()`. At 100-500 leads per campaign, sequential processing takes 30-120 seconds, well within Vercel's 5-minute function timeout.

No queue library needed. No Redis. No background worker at this scale.

### Deploy Tracking (New Prisma Model)

Track campaign deployment state for idempotency and UI status display:

```prisma
model CampaignDeploy {
  id                   String   @id @default(cuid())
  workspaceSlug        String
  campaignName         String   // matches EmailDraft.campaignName grouping
  emailBisonCampaignId Int
  status               String   @default("pending") // "pending" | "deploying" | "complete" | "failed"
  leadsDeployed        Int      @default(0)
  stepsDeployed        Int      @default(0)
  error                String?
  triggeredBy          String?  // "portal_approval" | "admin" | "agent"
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([workspaceSlug, campaignName])
}
```

Check for existing `CampaignDeploy` records before deploying to prevent double-deployment on page refresh or approval re-click.

### Files for Feature 3

| File | Action | What Changes |
|------|--------|-------------|
| `src/lib/emailbison/client.ts` | MODIFY | Add `addLeadToCampaign()`, `createSequenceStep()`, `updateSequenceStep()` |
| `src/lib/emailbison/types.ts` | MODIFY | Add `CreateSequenceStepParams`, `SequenceStepCreateResult` |
| `src/app/api/portal/[workspaceSlug]/deploy/route.ts` | CREATE | POST endpoint — orchestrates full deployment sequence |
| `prisma/schema.prisma` | MODIFY | Add CampaignDeploy model |

---

## Schema Changes (Complete)

Both new models added to `prisma/schema.prisma`. Deploy with `npx prisma db push` — consistent with all 7 v1.0 phases (no migration files).

```prisma
model PortalApproval {
  id            String   @id @default(cuid())
  workspaceSlug String
  entityType    String   // "leads_list" | "content_batch"
  entityId      String   // TargetList.id or campaignName
  status        String   @default("pending") // "pending" | "approved" | "rejected"
  approvedBy    String?  // client email from portal session
  feedback      String?  // rejection reason or notes
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([workspaceSlug, entityType])
  @@index([entityId])
}

model CampaignDeploy {
  id                   String   @id @default(cuid())
  workspaceSlug        String
  campaignName         String
  emailBisonCampaignId Int
  status               String   @default("pending") // "pending" | "deploying" | "complete" | "failed"
  leadsDeployed        Int      @default(0)
  stepsDeployed        Int      @default(0)
  error                String?
  triggeredBy          String?  // "portal_approval" | "admin" | "agent"
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  @@index([workspaceSlug, campaignName])
}
```

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| New queue/job library (BullMQ, Inngest, Trigger.dev) | Overkill for 100-500 lead batch upload; adds Redis or SaaS dependency; Vercel 5-min timeout is sufficient | `for...of` loop in serverless route, progress tracked on `CampaignDeploy.leadsDeployed` |
| `Promise.all()` for lead assignment | EmailBison will 429 on parallel lead creation; existing `RateLimitError` would surface as partial failures | Sequential `for...of` with `await` |
| New UI component library for portal | Portal is a simple approve/reject surface; adding another library bloats bundle | Existing shadcn/radix components already cover all needed elements |
| Per-lead approve/reject in portal | Explicitly out of scope in PROJECT.md | Binary `PortalApproval` (approved/rejected on whole list or batch) |
| Separate database for portal data | Portal is workspace-scoped in same Neon DB — no separation needed | Same Prisma client, same DB, `workspaceSlug` scoping |
| Polling for deploy status | Adds WebSocket/SSE complexity not warranted for an admin-triggered operation | Show deploy status from `CampaignDeploy` record on page load; refresh to update |

---

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ai@6.0.97` | `@ai-sdk/anthropic@3.0.46` | Major versions aligned (AI SDK v3 adapter for AI SDK v6 core). Never upgrade independently — upgrade both together or neither. |
| `ai@6.0.97` | `next@16.1.6` | `toUIMessageStreamResponse()` works in Next.js App Router route handlers. Tested in existing chat route. |
| `zod@4.3.6` | `ai@6.0.97` | AI SDK uses `inputSchema` field (not `parameters`) for tool definitions. Already correct throughout codebase — do not change the pattern. |
| `prisma@6.19.2` | `next@16.1.6` | Prisma client works in server components and API routes. Always use singleton from `src/lib/db.ts`, not `new PrismaClient()`. |
| `@ai-sdk/react@3.0.99` | `react@19.2.3` | `useChat` hook is React 19 compatible. No changes to chat UI required. |

---

## Installation

```bash
# No new packages required for v1.1 features.
# All three features use only existing installed dependencies.

# After schema changes:
npx prisma db push
```

---

## Sources

- Live codebase: `src/lib/agents/orchestrator.ts` — `delegateToLeads` stub confirmed at line 61-76 — HIGH confidence
- Live codebase: `src/lib/agents/types.ts` — `LeadsInput`, `LeadsOutput` types confirmed at lines 65-80 — HIGH confidence
- Live codebase: `src/lib/emailbison/client.ts` — existing methods confirmed, missing methods identified — HIGH confidence
- Live codebase: `prisma/schema.prisma` — `EmailDraft.status` values `'approved'`+`'deployed'` confirmed at line 284 — HIGH confidence
- Live codebase: `src/middleware.ts` — portal routing + auth infrastructure confirmed complete — HIGH confidence
- Live codebase: `package.json` + `node_modules/*/package.json` — all exact versions verified — HIGH confidence
- Live codebase: `src/app/api/chat/route.ts` — `streamText` + `orchestratorTools` integration pattern confirmed — HIGH confidence
- PROJECT.md: binary list approval confirmed out-of-scope for per-lead, `db push` as the established deploy pattern — HIGH confidence

---

*Stack research for: Outsignal v1.1 — Outbound Pipeline (Leads Agent + Portal Review + Smart Campaign Deploy)*
*Researched: 2026-02-27*
