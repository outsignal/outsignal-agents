# Feature Research

**Domain:** Outbound pipeline deployment — Leads Agent dashboard, client portal approval, smart campaign deploy
**Researched:** 2026-02-27
**Confidence:** HIGH for EmailBison API capabilities (verified from docs + existing client.ts); HIGH for portal UX patterns (verified from existing code + industry research); MEDIUM for client approval UX norms (from industry research, multiple sources)

---

> **Note:** This document supersedes the v1.0 FEATURES.md (which covered enrichment pipeline features, now all shipped).
> This file covers only **v1.1 milestone** features: Leads Agent in dashboard, client portal review/approval, and smart campaign deployment.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features for this milestone that users (Outsignal admins and their clients) assume will work. Missing these = milestone feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Leads Agent in dashboard Cmd+J** | Admin expects same natural-language access to leads ops as Writer/Research agents. MCP-only access is a dev tool, not a product. | MEDIUM | Follows existing orchestrator delegation pattern. `delegateToLeads` placeholder already in orchestrator.ts — needs real implementation wired to MCP tool set. |
| **Draft copy preview in portal** | Clients paying a retainer expect to see and approve copy before it goes out. "Trust us, we wrote something" is not acceptable. | MEDIUM | `EmailDraft` model with status field already exists (draft/review/approved/deployed). Portal needs a read view of drafts grouped by campaignName. |
| **Lead list preview in portal** | Client needs to confirm "yes, these are our ICP" before Outsignal sends to them. List approval = explicit consent gate for the campaign. | MEDIUM | `TargetList` model exists. Portal page needs a preview: sample of leads (name, company, title, vertical) + ICP coverage stats. No per-lead decisions — binary list-level approve/reject per PROJECT.md. |
| **Approve / reject actions in portal** | Approval is the point. Without an action button, the preview is just FYI. Need explicit approve/reject + optional feedback field. | LOW | Status state machine on TargetList and EmailDraft. Feedback text stored for writer revision loop. |
| **Admin visibility of approval state** | Admin needs to know when a client has approved so they can trigger deployment. Polling a portal page is not a workflow. | LOW | TargetList and EmailDraft status surfaced in admin workspace view. |
| **Deploy to EmailBison on approval** | The whole point of the milestone. Approved leads + approved copy → live campaign in EmailBison. Manual CSV upload is too slow for a client-facing product. | HIGH | EmailBison API supports: `POST /campaigns` (create), `POST /campaigns/sequence-steps` (add copy), `POST /campaigns/{id}/leads/attach-lead-list` or `attach-leads` (add leads). Full programmatic deployment is possible. |
| **Deploy leads and copy independently** | Sometimes copy is approved but leads aren't yet (or vice versa). System must handle partial approval states without blocking. | MEDIUM | Deploy logic must check what's approved and deploy only that. Leads-only deploy (no sequence steps) is valid for a campaign that will get copy added later. Copy-only deploy means creating campaign structure without leads. |
| **Verification gate on deploy** | Already enforced for CSV export. Must be enforced identically for EmailBison push. Deploying unverified emails to a live campaign is a deliverability disaster. | LOW | Reuse existing `getListExportReadiness()` + `verifyAndFilter()` — same gate, new trigger point (deploy vs CSV). |
| **Campaign naming convention** | EmailBison campaigns need a sensible name. Clients and Outsignal team need to recognise what campaign belongs to what list/copy batch. | LOW | Auto-generate: `{workspace} — {list name} — {YYYY-MM}`. Admin can override name pre-deploy. |
| **Deploy status feedback** | Admin and client need to know if deployment succeeded or failed. Silent failure = leads lost. | LOW | Deploy result stored on TargetList: `deployedAt`, `emailbisonCampaignId`, `deployStatus`. Surface in admin and portal. |

### Differentiators (Competitive Advantage)

Features that distinguish this product from manual workflows or basic client portal tools.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Smart deploy — leads + copy together** | Most agencies deploy leads to campaigns manually and add copy separately. One-click smart deploy detects what's approved and fires both in the correct order (campaign → sequence steps → leads). Eliminates a 15-minute manual task per campaign. | HIGH | Deployment sequence: 1) create campaign or find existing draft campaign, 2) POST sequence steps from approved EmailDrafts, 3) attach lead IDs from verified TargetList. Order matters — sequence steps must exist before leads are added in EmailBison. |
| **Leads Agent in natural-language chat** | The MCP tool is powerful but only accessible from Claude Code CLI. Moving it into the dashboard Cmd+J interface means non-technical Outsignal team members can run "find 200 fintech founders in London and add them to rise-q1 list" without writing tool calls. | HIGH | Needs a dedicated `leads` agent runner with its own system prompt and tools, separate from the orchestrator. The orchestrator delegates to it. Tool set mirrors the MCP but adapted for dashboard context. |
| **Client portal approval with feedback loop** | Client rejection of copy is inevitable. Instead of a Slack message saying "change X", the portal lets clients type rejection feedback directly on the draft. That feedback is surfaced to the Writer Agent on the next revision run, creating a closed loop without manual relay. | MEDIUM | `EmailDraft.feedback` field exists. Portal needs a rejection modal with text input. On re-run, Writer Agent `getExistingDrafts` already reads feedback and incorporates it. |
| **ICP preview in portal (sample not full list)** | Clients don't need to review 500 names. They need to see 5-10 representative samples and the ICP coverage stats (industry breakdown, seniority distribution, company size). This is enough to approve or flag ICP drift without overwhelming them. | LOW | Show top 10 people from list ordered by ICP score. Show enrichment coverage (email, LinkedIn, company), vertical breakdown, and score distribution. Client approves the ICP targeting, not the full list. |
| **Approval triggers notification** | When a client approves, Outsignal should know immediately. The existing Slack notification infrastructure handles this. Approval event = a Slack message to the workspace's Slack channel. | LOW | Reuse `notifications.ts` (already has `sendSlackNotification`). New event type: `CLIENT_APPROVED_LIST` / `CLIENT_APPROVED_COPY`. |
| **Lead scoring 1-10 in agent** | Agent-built lists should surface ICP score alongside person data so the admin can make informed choices ("agent found 80 leads but top 30 have score 7+, want to filter to those?"). | MEDIUM | `PersonWorkspace.icpScore` exists. Leads Agent tools need to expose scoring and filtering by score threshold. |
| **Deploy status in portal** | Client can see "Campaign launched" with the date after approval triggers deploy. Closes the loop — they approved it, they can see it went live. | LOW | TargetList `deployedAt` + campaign name visible in portal after deployment. |

### Anti-Features (Deliberately Not Build)

| Anti-Feature | Why Requested | Why Problematic | Alternative |
|--------------|---------------|-----------------|-------------|
| **Per-lead approve/reject in portal** | Clients want control over which specific leads get contacted | Creates a review burden of 200-500 items per list. Clients are not lead gen experts — they'll approve arbitrarily or block good leads for bad reasons. Destroys workflow speed. Already ruled out in PROJECT.md. | Binary list-level approval. If ICP targeting is right, individual lead review is unnecessary and counterproductive. |
| **Real-time portal approval notifications via websocket** | Instant notification UX | WebSocket complexity (Vercel serverless doesn't support persistent connections natively). Polling or webhook is simpler and sufficient at 6-client scale. | Poll approval status in admin dashboard. Slack notification fires on approval action via server-side. |
| **Copy editing in portal** | Clients want to tweak the copy themselves | Clients editing copy directly destroys the workflow loop. They're not copywriters. Direct edits create version conflicts with the Writer Agent's draft system. | Feedback field on rejection. Writer Agent incorporates feedback on next revision. |
| **Campaign scheduling/timing in portal** | Clients want to control send time | EmailBison handles scheduling internally. Adding scheduling to the portal is scope creep into EmailBison's territory. | Admin controls campaign start state (draft vs active). |
| **Approve individual sequence steps** | More granular copy review | If client can approve step 1 and reject step 2, the whole sequence becomes incoherent. Sequences are designed as a unit. | Approve or reject the whole sequence. If rejecting, provide feedback on what's wrong. |
| **Automatic deployment without admin review** | "Client approves → auto-deploys instantly" | Removes human check before a live campaign goes out. One approval bug or accidental click could push a bad campaign. Agency ops need to verify before launch. | Client approval → admin notification → admin triggers deploy. One admin click, not zero. |
| **Leads Agent replacing the MCP agent** | Consolidate to one interface | MCP agent is essential for programmatic/scripted workflows (bulk ops, cron-triggered ops). Dashboard agent is for interactive queries. They serve different contexts. | Both exist. Dashboard agent is the interactive layer; MCP agent is the automation layer. |

---

## Feature Dependencies

```
[Leads Agent — Dashboard]
    └──requires──> [Agent runner (existing)]
    └──requires──> [Leads tools (search, enrich, score, list ops)]
    └──enhances──> [Orchestrator delegateToLeads (wire up placeholder)]

[Client Portal — Lead List Preview]
    └──requires──> [TargetList model (exists)]
    └──requires──> [Portal session auth (exists)]
    └──requires──> [ICP score on PersonWorkspace (exists)]
    └──enables──> [Lead list approval action]

[Lead List Approval]
    └──requires──> [Client Portal — Lead List Preview]
    └──enables──> [Smart Deploy — Leads]
    └──triggers──> [Admin notification (Slack)]

[Client Portal — Copy Preview]
    └──requires──> [EmailDraft model (exists, status field exists)]
    └──requires──> [Portal session auth (exists)]
    └──enables──> [Copy approval action]

[Copy Approval]
    └──requires──> [Client Portal — Copy Preview]
    └──enables──> [Smart Deploy — Copy/Sequence Steps]
    └──triggers──> [Admin notification (Slack)]

[Smart Deploy — Campaign Creation]
    └──requires──> [Lead list approval OR copy approval (at least one)]
    └──requires──> [EmailBison client.createCampaign (exists)]
    └──must precede──> [Smart Deploy — Sequence Steps]
    └──must precede──> [Smart Deploy — Leads Attach]

[Smart Deploy — Sequence Steps]
    └──requires──> [Campaign created in EmailBison]
    └──requires──> [EmailDraft records with status=approved]
    └──requires──> [EmailBison API: POST /campaigns/sequence-steps (needs verification)]
    └──must precede──> [Smart Deploy — Leads Attach]

[Smart Deploy — Leads Attach]
    └──requires──> [Campaign created in EmailBison]
    └──requires──> [TargetList with status=approved]
    └──requires──> [Email verification gate (existing getListExportReadiness)]
    └──requires──> [EmailBison API: POST /campaigns/{id}/leads/attach-leads (confirmed)]

[Lead Scoring 1-10 in Agent]
    └──requires──> [PersonWorkspace.icpScore (exists)]
    └──enhances──> [Leads Agent — Dashboard]
    └──enhances──> [Client Portal — Lead List Preview]
```

### Dependency Notes

- **Deploy sequence is strictly ordered.** EmailBison requires: campaign exists → sequence steps added → leads attached. Cannot attach leads before campaign exists. Cannot test emails without sequence steps. Must preserve this order in deploy logic.
- **Both portal features (leads + copy) are independent.** Lead list preview and copy preview are separate portal pages. Either can be approved independently. Smart deploy checks approval state of both and deploys what's available.
- **Verification gate must run at deploy time**, not just at CSV export time. If leads were added to the list after the last verification check, new unverified emails could slip through. Re-verify at deploy trigger or enforce that list is locked after approval.
- **Leads Agent runner is separate from orchestrator.** The orchestrator delegates to it. The Leads Agent has its own config, system prompt, and tools. The placeholder `delegateToLeads` in orchestrator.ts becomes a real agent call.
- **EmailDraft status state machine.** Current states: `draft → review → approved → deployed`. The portal moves from `draft` to `review` when admin shares with client. Client action moves to `approved` or back to `draft` (with feedback). Deploy moves from `approved` to `deployed`.

---

## MVP Definition

### Launch With (v1.1)

Minimum viable outbound pipeline — covers the three active requirements from PROJECT.md.

- [ ] **Leads Agent in Cmd+J dashboard** — Natural language access to search, enrich, score, and list-build via the existing chat interface. Wires up the `delegateToLeads` placeholder. Must support: "find me 100 SaaS founders in the UK with ICP score 7+", "add them to list X", "enrich the top 50".
- [ ] **Client portal — lead list preview** — Portal page showing TargetList sample (top 10 by ICP score), coverage stats (email %, LinkedIn %, company %), vertical breakdown, total count. Approve / Reject with optional feedback.
- [ ] **Client portal — copy preview** — Portal page showing EmailDraft records for approved/pending sequences, grouped by campaignName. Step-by-step subject + body display. Approve whole batch or Reject with feedback.
- [ ] **Smart deploy — admin-triggered** — Admin workspace page: "Deploy campaign" button that checks approval state, runs verification gate, creates EmailBison campaign, pushes approved sequence steps, attaches verified leads. Handles partial approval (leads-only or copy-only).
- [ ] **Deploy status tracking** — TargetList gets `deployedAt`, `emailbisonCampaignId`, `deployStatus` fields. EmailDraft status transitions to `deployed`. Visible in admin and portal.
- [ ] **Approval notifications** — Client approval (list or copy) triggers Slack message to workspace channel via existing `notifications.ts`.

### Add After Validation (v1.1.x)

- [ ] **Lead scoring 1-10 surface in agent responses** — Agent currently has `icpScore` data but doesn't filter/sort by it in interactive output. Add score threshold filtering to agent tools and display in chat responses.
- [ ] **Portal approval history** — Show when each approval action happened and by whom. Currently there's no `approvedAt` timestamp or `approvedByEmail` field on the models.
- [ ] **Deploy preview** — Before triggering deploy, show admin: "Will create campaign X, attach N leads, push Y sequence steps." Confirmation step before live action.

### Future Consideration (v2+)

- [ ] **Automatic deploy on client approval** — Remove the admin-trigger step. Requires high confidence in verification and approval correctness. Current scale (6 clients) doesn't justify the risk.
- [ ] **Client portal campaign performance** — Already partially exists (portal/page.tsx shows campaigns). Deepen with per-campaign lead-level stats visible to client.
- [ ] **Copy revision round-trip in portal** — Client rejects → Writer Agent auto-reruns with feedback → admin reviews new draft → shares again. Current flow requires manual admin action to trigger re-run.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Leads Agent in dashboard Cmd+J | HIGH | MEDIUM | P1 |
| Client portal — lead list preview + approve | HIGH | MEDIUM | P1 |
| Client portal — copy preview + approve | HIGH | MEDIUM | P1 |
| Smart deploy (leads + copy to EmailBison) | HIGH | HIGH | P1 |
| Deploy status tracking (fields + UI) | HIGH | LOW | P1 |
| Approval notifications (Slack) | MEDIUM | LOW | P1 |
| Lead scoring in agent responses | MEDIUM | LOW | P2 |
| Portal approval history/timestamps | LOW | LOW | P2 |
| Deploy preview / confirmation step | MEDIUM | LOW | P2 |
| Automatic deploy on approval | MEDIUM | HIGH | P3 |
| Copy revision round-trip in portal | HIGH | HIGH | P3 |

**Priority key:**
- P1: Required for v1.1 milestone completion
- P2: Add once P1 features are working and validated
- P3: Future milestone — too complex or too risky for current scope

---

## Competitor Feature Analysis

How top cold email agencies and tools handle client review and campaign deployment in 2025-2026.

| Feature | Industry Pattern (2025-2026) | Typical Tool Approach | Our Approach |
|---------|------------------------------|----------------------|--------------|
| Client approval of lead targeting | Agencies do this via shared docs or email. No standard tool integration. | Not built into cold email tools (Smartlead, Instantly, EmailBison do not have client portals) | Native portal with list preview + binary approve/reject |
| Copy approval | Most agencies share copy via Google Docs or email. | Copywriting tools (Lavender, Reply.io) have internal review. No standard client-facing approval. | Portal copy preview with step-by-step display and approve/reject/feedback |
| Campaign deployment from approval | Manual: agency exports CSV, uploads to tool, adds sequence steps manually. 15-30 min per campaign. | EmailBison, Instantly, Smartlead all require manual UI interaction for sequence + lead setup | Programmatic: admin one-click triggers full deploy via EmailBison API |
| Leads agent / natural language list building | Clay has "Claygent" but it's credit-based and lives in Clay's UI | No email tool has this natively | Dashboard Cmd+J with Leads Agent delegation — unique to this product |
| Client results portal | Rare. SalesHive has a basic results portal. Most agencies use weekly email reports. | Not standard in cold email infrastructure tools | Existing portal shows campaigns + LinkedIn stats. Extend with approval flows. |

**Key insight (MEDIUM confidence, from web research 2026-02-27):** Industry-standard approval workflow for agencies is: Draft → Internal review → Client review → Revisions → Final approval → Delivery. No cold email tool implements this natively. The gap is real — agencies manage it through docs and email. Building it into the portal is genuinely differentiated.

**Key insight (HIGH confidence, from EmailBison API docs + existing client.ts):** Full programmatic campaign deployment is achievable. Confirmed API endpoints: `POST /campaigns` (create campaign, existing in client.ts), `POST /campaigns/{id}/leads/attach-leads` (confirmed in docs), `POST /campaigns/sequence-steps` (endpoint exists per docs but request schema needs verification — check `POST /campaigns/sequence-steps/{id}/send-test` pattern). The `duplicateCampaign` method already in client.ts suggests template-based deployment is also viable.

---

## EmailBison API Deploy Path — What's Known vs Needs Verification

This is a critical dependency for smart deploy. Documenting confidence levels here since this drives technical risk.

| API Capability | Confidence | Source | Notes |
|----------------|------------|--------|-------|
| `POST /campaigns` — create campaign | HIGH | client.ts already uses this | Works. Parameters: name, type, maxEmailsPerDay, maxNewLeadsPerDay, plainText |
| `POST /campaigns/{id}/duplicate` — clone template | HIGH | client.ts already uses this | Works. Useful for creating campaigns from a template campaign. |
| `POST /campaigns/{id}/leads/attach-leads` — add leads by ID | HIGH | Official EmailBison docs | Confirmed endpoint. Parameter: `lead_ids` array. 5-min sync delay after adding. |
| `POST /campaigns/{id}/leads/attach-lead-list` — add by list ID | MEDIUM | Official EmailBison docs | Confirmed endpoint but requires EmailBison-native lead list ID, not our DB list ID. Less useful than attach-leads. |
| `POST /campaigns/sequence-steps` — create email step with body/subject | MEDIUM | Inferred from `GET /campaigns/sequence-steps` existing + docs listing the endpoint | Endpoint exists per docs. Request body schema (campaign_id, position, subject, body, delay_days) not fully verified — need to test against live API or check API reference. |
| `PATCH /campaigns/{id}` — update campaign settings | MEDIUM | EmailBison developer page | Listed in docs. Parameters not fully verified. |
| `POST /leads` — create lead in EmailBison | HIGH | client.ts already uses this | Works. Returns `lead.id` needed for `attach-leads`. |

**Deploy flow recommendation based on above:**
1. Create leads in EmailBison via `POST /leads` (using existing `client.createLead`) → collect returned IDs
2. Create campaign via `POST /campaigns` (using existing `client.createCampaign`)
3. Create sequence steps via `POST /campaigns/sequence-steps` (needs verification of request schema)
4. Attach leads via `POST /campaigns/{id}/leads/attach-leads` with collected lead IDs

**Risk:** Step 3 (sequence steps creation) is MEDIUM confidence. If the request schema differs from expected (campaign_id, position, subject, body, delay_days), the deploy logic will need adjustment. Recommend building deploy as a separate service method on `EmailBisonClient` with error handling and logging before wiring to the approve button.

---

## Sources

- `/Users/jjay/programs/outsignal-agents/.planning/PROJECT.md` — Active milestone scope (HIGH confidence — authoritative)
- `/Users/jjay/programs/outsignal-agents/prisma/schema.prisma` — Data model: EmailDraft, TargetList, PersonWorkspace, MagicLinkToken (HIGH confidence — ground truth)
- `/Users/jjay/programs/outsignal-agents/src/lib/emailbison/client.ts` — Existing API client: createCampaign, duplicateCampaign, createLead, ensureCustomVariables confirmed working (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/orchestrator.ts` — Confirms delegateToLeads is a placeholder stub (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/agents/writer.ts` — EmailDraft save/read pattern, feedback field usage (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/lib/export/verification-gate.ts` — getListExportReadiness() and verifyAndFilter() already built and reusable (HIGH confidence)
- `/Users/jjay/programs/outsignal-agents/src/app/(portal)/portal/page.tsx` — Existing portal structure, magic link auth pattern (HIGH confidence)
- [EmailBison Adding Leads to Campaign docs](https://emailbison-306cc08e.mintlify.app/campaigns/adding-leads-to-a-campaign) — attach-leads and attach-lead-list endpoints confirmed (HIGH confidence)
- [EmailBison Developer page](https://emailbison.com/developers) — API overview, sequence-steps endpoint listed (MEDIUM confidence — not full schema)
- [QuantumByte Client Approval UX research](https://quantumbyte.ai/articles/best-client-review-and-approval-software-for-agencies-2026) — Industry approval workflow stages: Draft → Internal review → Client review → Revisions → Final approval → Delivery (MEDIUM confidence)
- [Cold email agency workflows 2025](https://coldiq.com/blog/best-cold-email-agencies) — Confirms agencies manage copy approval via docs/email, no standard tooling (MEDIUM confidence)

---
*Feature research for: Outbound pipeline deployment (v1.1 milestone)*
*Researched: 2026-02-27*
