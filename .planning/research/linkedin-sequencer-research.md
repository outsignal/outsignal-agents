# LinkedIn Sequencer Research: Multi-Channel Email + LinkedIn Orchestration

**Date**: 2026-02-26
**Status**: Research Complete

---

## 1. Executive Summary

The goal is to build a unified multi-channel sequencer where email touchpoints (via EmailBison) and LinkedIn touchpoints (via a LinkedIn automation tool) work as a single coordinated sequence. When Email 1 is sent in an EmailBison campaign, the system waits 24 hours, then automatically sends a LinkedIn connection request to the same prospect.

**Key findings:**

- **HeyReach is the best fit** -- it is already named in Outsignal proposals (`src/lib/proposal-templates.ts` line 66), has a REST API, supports multi-account rotation, and is designed for agencies.
- **EmailBison fires an `EMAIL_SENT` webhook event** (defined in `src/lib/emailbison/types.ts` line 152) that can trigger the LinkedIn action.
- **Inngest is the recommended orchestration layer** for delayed job execution on Vercel serverless, offering durable step functions with built-in delays, retries, and event-driven triggers.
- **The codebase is already structured for LinkedIn** -- the `WriterOutput` type includes `LinkedInStep`, the `EmailDraft` model has a `channel` field supporting `"linkedin"`, and workspaces store `linkedinUsername` credentials.

### David Mendoza's Approach (from YouTube tutorial)

An alternative $0/mo approach using:
- **Vercel's `agent-browser` package** (accessibility tree, not CSS selectors — undetectable by LinkedIn)
- **Google Sheets as queue** (we'd use PostgreSQL instead)
- **Priority-based queue** — warm/hot email replies get bumped to priority 1
- **Human-like delays** — 10-20 seconds between profile visits, ~80 visits/day
- **Modal** for serverless reply classification (we already have this via webhooks)
- **n8n** for workflow orchestration (we'd use Inngest or internal logic)

Key insight: the accessibility tree approach means LinkedIn cannot detect automation patterns, unlike CSS-selector-based tools.

---

## 2. Current Codebase Analysis

### 2.1 What Already Exists for LinkedIn

**Data Model** (`prisma/schema.prisma`):
- `Person.linkedinUrl` — stores the prospect's LinkedIn profile URL
- `Company.linkedinUrl` — stores the company's LinkedIn page URL
- `Workspace.linkedinUsername` — the client's LinkedIn account username for outreach
- `Workspace.linkedinPasswordNote` — password sharing field
- `EmailDraft.channel` — supports `"email"` | `"linkedin"`
- `EmailDraft.subjectLine` — nullable specifically for LinkedIn messages

**Agent System** (`src/lib/agents/types.ts`):
```typescript
export interface LinkedInStep {
  position: number;
  type: "connection_request" | "message" | "inmail";
  body: string;
  delayDays: number;
  notes: string;
}
```
The Writer Agent already generates LinkedIn sequences. The `WriterOutput` includes `linkedinSteps?: LinkedInStep[]`.

**Proposal System** (`src/lib/proposal-templates.ts`):
- LinkedIn Outbound package fully defined: setup GBP 1,500, platform GBP 350/mo, retainer GBP 850/mo
- Names "Heyreach or LinkedHelper" as the LinkedIn sequencer
- States TOS risk clearly: "automating LinkedIn connections and messaging is against the LinkedIn TOS"
- Max limit: 800 connections/month

### 2.2 EmailBison Integration

**Client** (`src/lib/emailbison/client.ts`):
- REST client with pagination, rate limiting, retry logic
- Methods: `getCampaigns()`, `getLeads()`, `getReplies()`, `getSequenceSteps()`, `getSenderEmails()`, `getTags()`

**Webhook Handler** (`src/app/api/webhooks/emailbison/route.ts`):
- Currently handles: `LEAD_REPLIED`, `LEAD_INTERESTED`, `UNTRACKED_REPLY_RECEIVED`
- Updates person status, triggers Slack and email notifications

**Webhook Types** (`src/lib/emailbison/types.ts`):
```typescript
export interface WebhookPayload {
  event: "EMAIL_SENT" | "REPLY_RECEIVED" | "BOUNCE" | "INTERESTED" | "UNSUBSCRIBED" | "TAG_ADDED";
  // ...
}
```

**Critical finding**: `EMAIL_SENT` is defined as a webhook event type — this is the trigger point.

### 2.3 What Is Missing

1. No LinkedIn automation client (no HeyReach or browser automation)
2. No orchestration/queue system (no Inngest, no Vercel Cron config)
3. No sequence orchestration model (no way to track multi-channel state per lead)
4. No `EMAIL_SENT` webhook handling (handler only processes reply/interested events)
5. No `vercel.json` cron configuration

---

## 3. LinkedIn Automation Tools & APIs

### 3.1 Option A: HeyReach (Cloud API — Recommended for production)

**URL**: https://heyreach.io
- Agency-first design, multi-account rotation
- API-driven campaigns, leads, and actions
- Webhook events for bi-directional flow
- Cloud-based (Vercel-compatible)
- ~$79/mo per LinkedIn account
- Already in Outsignal proposal stack

### 3.2 Option B: Agent-Browser (Self-hosted — $0/mo, from Mendoza tutorial)

**Package**: Vercel's `agent-browser` (npm)
- Uses accessibility tree instead of CSS selectors
- Undetectable by LinkedIn (no selector patterns to flag)
- Requires a machine running the browser (not serverless-compatible)
- Free, fully owned, customizable
- More brittle (UI changes can break it)
- Needs human-like delay orchestration (10-20s between actions)

### 3.3 Other Tools

| Tool | API Quality | Cloud | Agency | Multi-Account | Price/Seat | Fit |
|------|------------|-------|--------|---------------|------------|-----|
| **HeyReach** | Good | Yes | Excellent | Yes (rotation) | ~$79/mo | **Best** |
| Expandi | Moderate | Yes | Moderate | No | ~$99/mo | Good |
| Dripify | Basic | Yes | Basic | No | ~$59/mo | OK |
| PhantomBuster | Good | Yes | No | N/A | ~$69/mo | Niche |
| Linked Helper | Basic | No | No | No | ~$15/mo | Poor |
| LinkedIn API | N/A | N/A | N/A | N/A | Free | Not viable |

**LinkedIn Official APIs** do NOT support connection requests or direct messages programmatically.

---

## 4. EmailBison Integration Points

| Event | Current Handling | LinkedIn Sequencer Use |
|-------|-----------------|----------------------|
| `EMAIL_SENT` | **Not handled** | **Primary trigger** — starts 24h countdown |
| `REPLY_RECEIVED` | Handled (status + notification) | **Pause signal** — stop LinkedIn sequence |
| `BOUNCE` | Not handled | **Cancel signal** — do not contact on LinkedIn |
| `INTERESTED` | Handled (status + notification) | **Pause signal** — customize follow-up |
| `UNSUBSCRIBED` | Not handled | **Cancel signal** — mark DNC |

**Action needed**: Verify with EmailBison that `EMAIL_SENT` fires per individual email send (not just per campaign start).

**Polling fallback**: The existing client's `getLeads()` returns `lead_campaign_data` with `emails_sent` count per campaign. A cron-based approach can check which leads had Email 1 sent >24h ago.

---

## 5. Orchestration Architecture

### 5.1 Option A: Inngest (Recommended)

```typescript
const linkedinSequencer = inngest.createFunction(
  { id: "linkedin-after-email" },
  { event: "emailbison/email.sent" },
  async ({ event, step }) => {
    await step.sleep("wait-24h", "24h");

    const person = await step.run("check-status", async () => {
      return prisma.person.findUnique({ where: { email: event.data.leadEmail } });
    });

    if (person?.status === "replied" || person?.status === "interested") {
      return { skipped: true, reason: "Lead already engaged" };
    }

    await step.run("send-connection-request", async () => {
      return heyReachClient.sendConnectionRequest({
        linkedinUrl: person.linkedinUrl,
        note: event.data.connectionNote,
        campaignId: event.data.heyreachCampaignId,
      });
    });

    return { sent: true };
  }
);
```

- Built for Vercel, deploys as API routes
- Durable `step.sleep()` for arbitrary delays
- Automatic retries, cancellation support, monitoring dashboard
- Free tier: 5,000 runs/month (sufficient for launch)

### 5.2 Option B: Vercel Cron + Database Queue

`EMAIL_SENT` webhook writes to a `LinkedInQueue` table with `scheduledAt = now() + 24h`. Cron runs every 15 minutes, processes pending items. Simple, no external deps, but manual idempotency/recovery.

### Architecture Comparison

| Approach | Complexity | Reliability | Cost | Serverless | Monitoring |
|----------|-----------|-------------|------|-----------|------------|
| **Inngest** | Low | Excellent | Free-$25/mo | Yes | Built-in |
| Trigger.dev | Medium | Excellent | Free-$30/mo | Partial | Built-in |
| Vercel Cron + DB | Medium | Good | Free | Yes | Custom |
| BullMQ + Redis | High | Excellent | $10-30/mo | No | Separate |

---

## 6. Sequence Design Patterns

### 6.1 Recommended Multi-Channel Template

```
Day 0:  Email 1 (cold intro via EmailBison)
Day 1:  LinkedIn Connection Request (personalized note, 24h after Email 1)
Day 3:  Email 2 (follow-up via EmailBison)
Day 5:  LinkedIn Message (if connected — "saw you got my email")
Day 7:  Email 3 (breakup/value add via EmailBison)
Day 10: LinkedIn InMail (if not connected — last touch, requires Premium)
```

### 6.2 Branching Logic

```
                Email 1 Sent
                    |
                [Wait 24h]
                    |
            Has Lead Replied? ──Yes──> STOP
                    |
                   No
                    |
            Has LinkedIn URL? ──No──> Email-only sequence
                    |
                   Yes
                    |
          Send Connection Request
                    |
                [Wait 48h]
                    |
            ┌───────┴───────┐
       Accepted?        Not Accepted?
            |                |
     Send LinkedIn      Continue Email
       Message          Sequence Only
```

### 6.3 Safety and Throttling

**Daily limits** (conservative):
- Connection requests: 20-25/day per LinkedIn account
- Messages to 1st-degree: 50-75/day
- InMails: ~50/month (Sales Navigator)
- Max 800 connections/month (per proposals)

---

## 7. Compliance & Risk

### 7.1 Risk by Action Type

| Action | Risk | Notes |
|--------|------|-------|
| Profile view | Very Low | Expected behavior |
| Connection request (with note) | Low-Medium | Keep under 20-25/day |
| Message to 1st-degree | Low | Normal behavior |
| InMail | Very Low | LinkedIn sells these |
| Bulk scraping | High | Primary enforcement focus |

### 7.2 Protection Strategy

1. Never use client's primary LinkedIn — create dedicated outreach profile
2. Warm up: 5-10 CR/day, increase by 5/week to 20-25/day over first month
3. Quality targeting via ICP data reduces volume needed
4. Always personalized notes (higher accept rate, lower flag rate)
5. Monitor accept rates — below 20% means pause and reassess
6. Business hours only (8am-6pm prospect timezone)
7. Reduce/pause on weekends

---

## 8. Recommended Approach

### Tool: HeyReach (production) or agent-browser (budget/pilot)

**HeyReach** for production multi-client use. **Agent-browser** for a $0 pilot or single-client test.

### Orchestration: Inngest

Durable step functions with built-in delays, retries, and event-driven triggers. Free tier covers launch.

### Architecture

```
EmailBison ──> Webhook (EMAIL_SENT) ──> Inngest Event ──> [sleep 24h] ──> HeyReach/agent-browser (send CR)
EmailBison ──> Webhook (REPLY)      ──> Inngest Event ──> [cancel pending LinkedIn actions]
HeyReach   ──> Webhook (accepted)   ──> Inngest Event ──> [sleep 48h] ──> HeyReach (send msg)
HeyReach   ──> Webhook (replied)    ──> Update Person, Notify Team, Pause Email
```

### Data Model Changes

**New models needed:**
- `SequenceEnrollment` — tracks each lead's position in multi-channel sequence
- `LinkedInAction` — audit log of all LinkedIn actions

**Workspace additions:** `heyreachApiKey`, `heyreachCampaignId`, `liDailyLimit`, `liWarmupDays`

---

## 9. Open Questions

1. **HeyReach API access**: Do we have an account? Confirm API availability on current plan
2. **EMAIL_SENT webhook**: Verify EmailBison actually fires this per email sent (not just a type definition)
3. **LinkedIn URL coverage**: What % of ~14,563 people have `linkedinUrl`?
4. **Which workspaces first?**: All 6 or pilot with 1-2?
5. **LinkedIn accounts**: Do clients have accounts already connected to HeyReach?
6. **Inngest vs Vercel Cron**: Is Inngest's reliability worth the dependency for MVP?
7. **Agent-browser pilot**: Worth testing Mendoza's approach before committing to HeyReach?

---

*Research grounded in codebase analysis of: emailbison client, webhook handler, schema, agent types, proposal templates, writer agent*
*Video reference: David Mendoza "Build a $0/mo LinkedIn Outreach System with Claude Code"*
