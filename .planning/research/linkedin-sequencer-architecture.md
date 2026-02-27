# LinkedIn Sequencer — Architecture Research (Consolidated)

**Date**: 2026-02-26
**Status**: Research Complete
**Sources**: David Mendoza tutorial ([video notes](linkedin-video-notes.md)), HeyReach ABM blog, codebase analysis, internal requirements

---

## 1. Problem Statement

Outsignal clients need multi-channel outreach combining email (EmailBison) and LinkedIn into coordinated sequences. The system must handle different client setups — from a single free LinkedIn account running email-only, to multiple senders with paid accounts running interleaved email+LinkedIn sequences.

**Key constraints:**
- Not every client wants LinkedIn — some run email only
- Not every client has paid LinkedIn accounts — system must degrade gracefully (no InMail on free accounts)
- One client can have multiple senders, each with their own LinkedIn account
- One sender can be active across multiple concurrent campaigns
- LinkedIn accounts must be protected from bans at all costs

---

## 2. Current Codebase (What Already Exists)

### 2.1 Data Model (`prisma/schema.prisma`)
- `Person.linkedinUrl` — prospect's LinkedIn profile URL
- `Company.linkedinUrl` — company's LinkedIn page URL
- `Workspace.linkedinUsername` — client's LinkedIn account username
- `Workspace.linkedinPasswordNote` — password sharing field
- `EmailDraft.channel` — supports `"email"` | `"linkedin"`
- `EmailDraft.subjectLine` — nullable specifically for LinkedIn messages

### 2.2 Agent System (`src/lib/agents/types.ts`)
```typescript
export interface LinkedInStep {
  position: number;
  type: "connection_request" | "message" | "inmail";
  body: string;
  delayDays: number;
  notes: string;
}
```
The Writer Agent already generates LinkedIn sequences. `WriterOutput` includes `linkedinSteps?: LinkedInStep[]`.

### 2.3 Proposal System (`src/lib/proposal-templates.ts`)
- LinkedIn Outbound package defined: setup GBP 1,500, platform GBP 350/mo, retainer GBP 850/mo
- Names "Heyreach or LinkedHelper" as the LinkedIn sequencer
- States TOS risk: "automating LinkedIn connections and messaging is against the LinkedIn TOS"
- Max limit: 800 connections/month

### 2.4 EmailBison Integration
**Webhook types** (`src/lib/emailbison/types.ts`):
```typescript
export interface WebhookPayload {
  event: "EMAIL_SENT" | "REPLY_RECEIVED" | "BOUNCE" | "INTERESTED" | "UNSUBSCRIBED" | "TAG_ADDED";
}
```
- `EMAIL_SENT` is defined but **not currently handled** — this is the LinkedIn trigger point
- Currently handles: `LEAD_REPLIED`, `LEAD_INTERESTED`, `UNTRACKED_REPLY_RECEIVED`

### 2.5 What Is Missing
1. No LinkedIn automation client (no HeyReach API client or browser automation)
2. No orchestration/queue system (no Inngest, no cron config)
3. No multi-channel sequence model (no way to track per-lead sequence state)
4. No `EMAIL_SENT` webhook handling
5. No Sender entity (workspace-level LinkedIn, not per-person)
6. No rate limiting infrastructure for LinkedIn actions

---

## 3. Campaign Modes

Each campaign is configured with one of three channel modes:

| Mode | Description | Use Case |
|------|-------------|----------|
| **Email Only** | Current EmailBison behavior, no LinkedIn | Clients without LinkedIn, or campaigns where it's not wanted |
| **LinkedIn Only** | Standalone LinkedIn sequences (connect → message on accept) | LinkedIn-first outreach, no cold email |
| **Email + LinkedIn** | Unified sequence with both channels | Full multi-channel outreach |

Within **Email + LinkedIn**, step ordering is fully configurable:
- Email first, LinkedIn after (most common)
- Interleaved (Email 1 → LinkedIn connect → Email 2 → LinkedIn message)
- LinkedIn first, email after

---

## 4. Core Entities

### 4.1 Sender

A **Sender** represents a real person who sends outreach on behalf of a client. Each sender has:
- **Email identity**: the email address used in EmailBison campaigns
- **LinkedIn identity**: LinkedIn account credentials/session (optional — not all senders have LinkedIn)
- **Workspace**: belongs to a client workspace

This is the critical join point. When Alice sends Email 1 to a prospect, the system uses Alice's LinkedIn account for the connection request — not Bob's.

```
Workspace (Rise)
├── Sender: Alice
│   ├── Email: alice@rise.com (used in EmailBison)
│   ├── LinkedIn: /in/alice-smith (session stored)
│   ├── Campaigns: Campaign A, Campaign C
│   └── Daily budget: shared across A and C
└── Sender: Bob
    ├── Email: bob@rise.com (used in EmailBison)
    ├── LinkedIn: /in/bob-jones (session stored)
    ├── Campaigns: Campaign B, Campaign C
    └── Daily budget: shared across B and C
```

Campaign C uses both senders — prospects are assigned to a sender when they enter the campaign, and that assignment is sticky throughout the sequence.

### 4.2 Campaign Sequence Steps

A campaign defines an ordered list of **steps**, each with:
- **Channel**: `email` or `linkedin`
- **Action type**: `send_email`, `connection_request`, `follow_up_message`, `profile_visit`, `inmail`
- **Delay**: wait time after previous step (e.g., 24h, 48h)
- **Condition** (optional): `connection_accepted`, `no_reply`, etc.
- **Message template**: content with {{variable}} substitution

Example (Email + LinkedIn, email first):
```
Step 1: send_email         — Email 1 (intro)
Step 2: connection_request — wait 24h, blank invite
Step 3: send_email         — wait 48h, Email 2 (follow-up)
Step 4: follow_up_message  — on connection accepted, ties into email narrative
Step 5: send_email         — wait 72h, Email 3 (break-up)
```

Example (LinkedIn only):
```
Step 1: profile_visit       — visit profile
Step 2: connection_request  — wait 24h, blank invite
Step 3: follow_up_message   — on accept, intro message
Step 4: follow_up_message   — wait 72h, value-add message
```

### 4.3 LinkedIn Action Queue

A single queue of LinkedIn actions across all campaigns, ordered by:
1. **Priority** (1 = warm reply, execute ASAP; 2 = scheduled sequence step)
2. **Scheduled time** (when the action should fire based on step delays)

Each queued action references the person, sender, campaign + step, priority, and status (`pending` → `ready` → `in_progress` → `completed` | `failed` | `skipped` | `expired`).

### 4.4 LinkedIn Account Config

Per sender:
- Session/cookie data for agent-browser (or HeyReach account link)
- Account tier: `free` or `premium` (determines available actions)
- Configurable daily limits
- Current daily usage counters (reset at midnight)
- Account health status: `active`, `restricted`, `banned`

---

## 5. Priority System — Warm Reply Fast-Track

When EmailBison fires `LEAD_REPLIED` or `LEAD_INTERESTED`:

1. Look up the person in the database
2. Check if they have a LinkedIn URL
   - Yes → queue priority 1 connection request for the correct sender
   - No → trigger LinkedIn URL enrichment (Prospeo/Clay), then queue on success
3. If a connection request is already pending → bump to priority 1
4. If already connected → queue priority 1 follow-up message referencing the reply

The sender is determined by matching the originating email address to a Sender's email identity → their linked LinkedIn account.

---

## 6. Rate Limiting & Account Protection

### 6.1 Account-Level Throttling

Limits enforced **per LinkedIn account**, not per campaign. Alice's daily budget is shared across all her campaigns.

| Action | Free Account | Premium Account | Delay Between |
|--------|-------------|-----------------|---------------|
| Connection requests | 20/day | 30/day | 10-20s random |
| Messages | 30/day | 50/day | 10-20s random |
| Profile visits | 80/day | 80/day | 10-20s random |
| InMails | 0 | 20/day | 10-20s random |

### 6.2 Priority Budget Reservation

- Reserve a portion of daily budget for priority 1 actions (e.g., hold back 5 connection requests for warm leads)
- Priority 2 (cold sequence) fills the remainder
- If warm reply arrives and budget is exhausted → queues for next day at the top

### 6.3 Human-Like Behavior

- Random delays 10-20 seconds between actions
- Vary daily volume (don't send exactly 20 every day — randomize ±15%)
- No activity outside business hours (configurable per timezone)
- Gradual ramp-up for new accounts: start at 5/day, increase by 5/week over first month
- Cool-down if LinkedIn shows warning signs

### 6.4 Non-Response Recycling

- Connection request not accepted within 14 days → mark `expired`
- Don't retry immediately
- Re-enter awareness pool after 3-6 months (per HeyReach ABM pattern)

### 6.5 Accept Rate Monitoring

- Track accept rates per sender
- Below 20% → pause and reassess targeting/messaging
- High accept rates (>40%) = healthy account signal

---

## 7. Follow-Up Messages on Connection Accept

### 7.1 Email + LinkedIn Campaigns
- References the email thread ("I reached out via email about X — glad to connect here too")
- Continues the value proposition without repeating email content
- Message template has access to: campaign context, emails sent so far, reply history

### 7.2 LinkedIn-Only Campaigns
- Own narrative arc, independent of email
- LinkedIn-native patterns (shorter, more conversational)
- Typical flow: intro message → value-add → soft CTA

### 7.3 Connection Accept Detection
- Poll connection status periodically via agent-browser (or HeyReach webhook)
- On accept → trigger next `follow_up_message` step in sequence

---

## 8. EmailBison Integration Points

| Event | Current State | LinkedIn Sequencer Use |
|-------|--------------|----------------------|
| `EMAIL_SENT` | **Not handled** | **Primary trigger** — starts delay countdown to LinkedIn step |
| `REPLY_RECEIVED` | Handled (status + notification) | **Pause signal** — stop LinkedIn sequence, optionally fast-track connection |
| `BOUNCE` | Not handled | **Cancel signal** — do not contact on LinkedIn |
| `INTERESTED` | Handled (status + notification) | **Fast-track** — priority 1 connection request |
| `UNSUBSCRIBED` | Not handled | **Cancel signal** — mark DNC across all channels |

**Open question**: Verify `EMAIL_SENT` fires per individual email send (not just per campaign start). Polling fallback available via `getLeads()` which returns `emails_sent` count.

---

## 9. LinkedIn Automation Tools

### Option A: HeyReach (Cloud API — recommended for production)
- Agency-first, multi-account rotation, API-driven
- Cloud-based (Vercel-compatible, no browser needed)
- ~$79/mo per LinkedIn account
- Already in Outsignal proposal stack
- Webhooks for bi-directional flow (connection accepted, reply received)

### Option B: agent-browser (Self-hosted — $0/mo, Mendoza approach)
- Vercel's `agent-browser` npm package
- Accessibility tree instead of CSS selectors → undetectable by LinkedIn
- Requires a machine running the browser (not serverless)
- Free, fully owned, customizable
- More brittle (LinkedIn UI changes can break it)
- Best for: pilot, single-client test, budget-conscious

### Comparison

| Factor | HeyReach | agent-browser |
|--------|----------|---------------|
| Cost | ~$79/mo per account | $0 (+ hosting) |
| Setup | API key, done | Browser sessions, cookies, hosting |
| Reliability | High (maintained product) | Medium (DIY maintenance) |
| Detection risk | Low (built-in safety) | Very low (accessibility tree) |
| Multi-account | Built-in rotation | Manual per-session |
| Serverless | Yes | No (needs persistent process) |
| Monitoring | Dashboard | Custom |

**Recommendation**: HeyReach for production multi-client use. Agent-browser for $0 pilot or as fallback.

---

## 10. Orchestration Layer

### Recommended: Inngest

Durable step functions with built-in delays, retries, and event-driven triggers. Designed for Vercel serverless.

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
      return linkedinClient.sendConnectionRequest({
        linkedinUrl: person.linkedinUrl,
        senderAccountId: event.data.senderId,
      });
    });
  }
);
```

- Free tier: 5,000 runs/month (sufficient for launch)
- Built-in monitoring dashboard
- Cancellation support (cancel pending LinkedIn actions when lead replies)

### Alternative: Vercel Cron + Database Queue

`EMAIL_SENT` webhook writes to `LinkedInAction` table with `scheduledFor = now() + 24h`. Cron runs every 15 minutes, processes pending items. Simpler, no external deps, but manual idempotency/recovery.

---

## 11. Data Model (Prisma)

```prisma
model Sender {
  id              String   @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id])
  name            String
  email           String   // email used in EmailBison
  linkedInUrl     String?  // LinkedIn profile URL
  linkedInSession Json?    // encrypted session/cookie data
  linkedInTier    String   @default("free") // "free" | "premium"
  dailyLimits     Json     // { connectionRequests: 20, messages: 30, profileVisits: 80, inmails: 0 }
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  linkedInActions  LinkedInAction[]
  campaignSenders  CampaignSender[]
}

model CampaignSender {
  id         String   @id @default(cuid())
  campaignId String
  senderId   String
  sender     Sender   @relation(fields: [senderId], references: [id])
  createdAt  DateTime @default(now())

  @@unique([campaignId, senderId])
}

model CampaignSequenceStep {
  id           String   @id @default(cuid())
  campaignId   String
  stepOrder    Int
  channel      String   // "email" | "linkedin"
  actionType   String   // "send_email" | "connection_request" | "follow_up_message" | "profile_visit" | "inmail"
  delayMinutes Int      // delay after previous step
  condition    String?  // "connection_accepted" | "no_reply" | null
  template     String?  // message template with {{variables}}
  createdAt    DateTime @default(now())

  @@unique([campaignId, stepOrder])
}

model LinkedInAction {
  id             String    @id @default(cuid())
  personId       String
  senderId       String
  sender         Sender    @relation(fields: [senderId], references: [id])
  campaignId     String?
  stepOrder      Int?
  actionType     String    // "connection_request" | "follow_up_message" | "profile_visit" | "inmail"
  priority       Int       @default(2) // 1 = urgent (warm reply), 2 = normal
  status         String    @default("pending") // pending | ready | in_progress | completed | failed | skipped | expired
  scheduledFor   DateTime
  executedAt     DateTime?
  messageContent String?
  errorMessage   String?
  retryCount     Int       @default(0)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  @@index([senderId, status, priority, scheduledFor])
  @@index([personId])
}

model LinkedInDailyUsage {
  id                 String   @id @default(cuid())
  senderId           String
  date               DateTime @db.Date
  connectionRequests Int      @default(0)
  messages           Int      @default(0)
  profileVisits      Int      @default(0)
  inmails            Int      @default(0)

  @@unique([senderId, date])
}
```

---

## 12. Sequence Flow Diagrams

### 12.1 Email + LinkedIn (email first)
```
                Email 1 Sent (EmailBison)
                        |
                   [Wait 24h]
                        |
                Has Lead Replied? ──Yes──> Fast-track P1 connection + STOP email
                        |
                       No
                        |
                Has LinkedIn URL? ──No──> Email-only sequence continues
                        |
                       Yes
                        |
              Send Connection Request
              (from correct sender's account)
                        |
                   [Wait 48h]
                        |
                ┌───────┴───────┐
           Accepted?        Not Accepted
                |                |
         Send LinkedIn      Continue Email
           Message          Sequence Only
        (ties into email     (recycle after
          narrative)          14 days)
```

### 12.2 Warm Reply Fast-Track
```
EmailBison webhook: LEAD_REPLIED / LEAD_INTERESTED
        |
  Look up Person
        |
  Has LinkedIn URL? ──No──> Trigger enrichment (Prospeo/Clay)
        |                         |
       Yes                   URL found?
        |                    Yes ──┐
        |                          |
  Pending LinkedIn action? ────────┤
        |                          |
       Yes                        No
        |                          |
  Bump to Priority 1     Queue new P1 connection
        |                   for correct sender
        └──────────┬───────────┘
                   |
          Execute ASAP (next
          available slot in
          daily budget)
```

---

## 13. Open Questions

1. **EMAIL_SENT webhook**: Does EmailBison fire this per individual send? Or just a type definition? Polling fallback exists.
2. **LinkedIn URL coverage**: What % of 14,563 people have `linkedinUrl`? Determines enrichment effort needed.
3. **HeyReach vs agent-browser**: Start with HeyReach for reliability, or pilot agent-browser for $0?
4. **LinkedIn session management**: How to securely store and refresh sessions? Cookie expiry handling?
5. **Multi-sender assignment**: Round-robin, manual, or territory-based when campaign has multiple senders?
6. **Connection accept detection**: HeyReach webhooks vs polling? How often?
7. **Message personalization**: AI-generated per prospect, or templates with variable substitution?
8. **Dashboard visibility**: Do clients see LinkedIn queue status, or internal-only?
9. **Failure handling**: What happens if agent-browser fails mid-session? Recovery strategy?
10. **Account warm-up**: Automated ramp-up schedule, or manual?
11. **Inngest vs Vercel Cron**: Reliability vs simplicity tradeoff for MVP?
12. **Which clients first**: Pilot with 1-2 workspaces or roll out to all 6?
13. **GDPR/compliance**: Legal considerations specific to LinkedIn automation?
