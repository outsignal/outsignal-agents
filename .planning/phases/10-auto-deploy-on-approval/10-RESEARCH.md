# Phase 10: Auto-Deploy + Email ↔ LinkedIn Sequencing - Research

**Researched:** 2026-03-02
**Domain:** Campaign deployment pipeline + cross-channel sequencing
**Confidence:** HIGH

## Summary

Phase 10 builds the deploy pipeline that bridges Outsignal's campaign management system with EmailBison (email) and the LinkedIn sequencer worker (Railway). The core challenge is orchestrating a fire-and-forget background deployment that pushes leads and content to external systems, tracks status via a CampaignDeploy model, and wires cross-channel sequencing rules so LinkedIn actions fire based on email events.

The codebase already provides all building blocks: EmailBisonClient with `createCampaign()` and `createLead()` methods, LinkedIn action queue (`enqueueAction()`) with sender assignment, campaign operations layer with state machine, notification infrastructure, and the webhook handler that processes EMAIL_SENT events. Phase 10 assembles these into a cohesive deploy flow.

The key architectural decision is the deploy trigger. Per CONTEXT.md, this is a **manual admin trigger** via a "Deploy Campaign" button (not auto-deploy on approval as originally planned). The button calls `POST /api/campaigns/[id]/deploy`, which returns immediately and runs the actual deployment asynchronously.

**Primary recommendation:** Use Vercel's `waitUntil()` for fire-and-forget async execution within the deploy API route, add a CampaignDeploy model to track status, extend EmailBisonClient with sequence step creation, and add Handlebars template compilation for LinkedIn message personalization.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Manual admin trigger via "Deploy Campaign" button (not auto on approval)
- Button on campaign detail page, only visible when both approvals are in and status isn't already deployed
- Confirmation modal before deploy: shows campaign name, lead count, channels, sequence step count
- Fire-and-forget Next.js API route (POST /api/campaigns/[id]/deploy) — returns immediately, runs async
- CampaignDeploy record tracks status: pending → running → complete / partial_failure / failed
- Partial failure supported: track which channel failed, admin can retry failed channel only
- Final status only (no real-time progress) — admin sees result on campaign detail page
- Deploy history table on campaign detail: timestamp, status, lead count, channels, error
- Both step-based and event-based triggers supported via `triggerType` field on CampaignSequenceRule
- Step-based (primary): "After Email Step X is sent, wait Y hours, then do LinkedIn Action Z"
- Event-based (optional): fire on EmailBison webhook events (EMAIL_SENT, EMAIL_OPENED, LINK_CLICKED)
- Full Handlebars-style template engine for LinkedIn messages: {{firstName}}, {{companyName}}, {{emailSubject}}, plus conditionals like {{#if emailOpened}}
- Auto-queue follow-up on connection accept — next LinkedIn step queued with configurable delay
- Up to 5 LinkedIn steps per sequence (to accommodate future action types like post likes/comments)
- Email steps: per-step `delayDays` field (e.g., Step 1 at day 0, Step 2 at day 3, Step 3 at day 7)
- LinkedIn steps: per-step `delayHours` field (e.g., connection request at deploy, follow-up 48h after accept)
- Per-sender daily cap for LinkedIn actions (e.g., 25 connection requests/day). Excess rolls to next day.
- Cross-channel: LinkedIn actions only fire after their linked email step is confirmed sent (email triggers LinkedIn)
- LinkedIn-only campaigns: actions queued with configurable delays between steps per lead (same gap model as email), NOT all-at-once
- Campaign has explicit `channels` field: ['email'], ['linkedin'], or ['email', 'linkedin']
- Deploy only pushes to selected channels
- Email content: 1:1 ordered mapping — Campaign.emailSequence[0] → EB Step 1, [1] → Step 2, etc.
- Dedup: Outsignal-side check first (skip leads already deployed) + EmailBison's own dedup as fallback
- Campaign.status === 'deployed' serves as deploy mutex
- Deploy success/failure: Slack notification to workspace channel + status visible on campaign detail page
- Notification includes summary: campaign name, lead count, email steps, LinkedIn steps, status
- EmailBison API down: retry 3x with exponential backoff, then mark as failed. Admin can manually retry.
- Daily cron includes proactive sender session refresh: flag sessions older than 6 days for re-auth (pairs with Phase 13)
- Poll every 2 hours via Railway worker (not daily cron — faster follow-up response)
- On accept: auto-queue next LinkedIn step with configured delay
- If original sender is flagged (Phase 13): reassign follow-up to healthy sender if available; if no healthy sender, hold until one recovers
- Connection request timeout: if no accept after N days, auto-withdraw request, wait cooldown period, then retry once. Exact thresholds at Claude's discretion.
- Declined/withdrawn: mark lead as 'connection_failed', skip remaining LinkedIn steps for that lead

### Claude's Discretion
- Exact Handlebars template compilation approach
- CampaignSequenceRule schema design details
- Connection request timeout + cooldown day thresholds
- Exponential backoff timing for EB retry
- Railway worker polling implementation (interval mechanism)
- CampaignDeploy partial retry API design

### Deferred Ideas (OUT OF SCOPE)
- LinkedIn post likes and comments as action types — future action type enum values, not Phase 10 scope
- Auto-deploy on dual approval (originally planned) — user chose manual trigger instead; could revisit later
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DEPLOY-02 | On dual approval, auto-deploy triggers without admin intervention | CONTEXT.md changed this to manual trigger. Deploy button appears when status === 'approved'. The approval flow (Phase 9) already auto-transitions to 'approved' on dual approval. |
| DEPLOY-03 | System creates EmailBison campaign with sequence steps | EmailBisonClient.createCampaign() exists. Need to add createSequenceStep() method. EB API: POST /campaigns/{id}/sequence-steps. |
| DEPLOY-04 | System pushes verified leads to EmailBison workspace | EmailBisonClient.createLead() exists. Need batch wrapper with dedup logic. Manual campaign assignment in EB UI (no API). |
| DEPLOY-05 | System queues LinkedIn messages via LinkedIn sequencer worker on Railway | enqueueAction() in src/lib/linkedin/queue.ts handles this. Need batch enqueueing with delay scheduling per CampaignSequenceRule. |
| DEPLOY-06 | CampaignDeploy record tracks status | New CampaignDeploy Prisma model. Links to Campaign, tracks per-channel status, lead count, error messages. |
| DEPLOY-07 | Deploy handles email-only, LinkedIn-only, or both channels | Campaign.channels field already exists as JSON array. Deploy logic branches on channel presence. |
| SEQ-01 | EMAIL_SENT webhook triggers LinkedIn actions via CampaignSequenceRule | Webhook handler at src/app/api/webhooks/emailbison/route.ts already handles EMAIL_SENT. Add CampaignSequenceRule lookup + enqueue logic. |
| SEQ-02 | CampaignSequenceRule maps email steps to LinkedIn actions | CampaignSequenceRule model already exists in schema with triggerEvent, triggerStepRef, actionType, messageTemplate, delayMinutes, position fields. |
| SEQ-03 | Connection accept detection polls periodically | Worker on Railway polls. Need check_connection action type (already in enum) + polling loop in worker for pending connections. |
| SEQ-04 | LinkedIn message templates reference email step context | Handlebars-style template compilation. Use handlebars npm package for {{firstName}}, {{companyName}}, conditionals. |
| SEQ-05 | Sender session refresh on daily cron | Add to existing Vercel cron. Check Sender.updatedAt or sessionData age, flag for re-auth if >6 days. |
</phase_requirements>

## Standard Stack

### Core (Already in Project)
| Library | Purpose | Status |
|---------|---------|--------|
| Prisma 6 | ORM for CampaignDeploy model, CampaignSequenceRule queries | Existing — push-based schema workflow |
| Next.js 16 | API routes for deploy endpoint, webhook handler extension | Existing |
| EmailBisonClient | Email campaign creation + lead push | Existing at src/lib/emailbison/client.ts — needs sequence step method |
| LinkedIn queue | Action enqueueing with priority/scheduling | Existing at src/lib/linkedin/queue.ts |
| LinkedIn sender | Sender assignment (email match or round-robin) | Existing at src/lib/linkedin/sender.ts |
| Notification infra | Slack + email notifications | Existing at src/lib/notifications.ts |

### New Dependencies
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| handlebars | ^4.7 | LinkedIn message template compilation | Industry standard for {{variable}} syntax with conditionals. Lightweight, no XSS concern (server-side only). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Handlebars | Simple string replace | Loses conditional support ({{#if emailOpened}}). User explicitly requested Handlebars-style with conditionals. |
| Vercel waitUntil | Vercel Background Functions | waitUntil is simpler, no extra config. Background Functions are Pro-tier. Both fire-and-forget. |

## Architecture Patterns

### Deploy Pipeline Flow
```
Admin clicks "Deploy Campaign" →
  POST /api/campaigns/[id]/deploy →
    1. Validate: status === 'approved', channels, leads exist
    2. Create CampaignDeploy record (pending)
    3. Transition Campaign status → 'deployed'
    4. Return 200 immediately
    5. waitUntil(async () => {
         Update CampaignDeploy → running
         For each channel:
           email: createEBCampaign → createSequenceSteps → pushLeads
           linkedin: createSequenceRules → enqueueInitialActions
         Update CampaignDeploy → complete | partial_failure | failed
         Send deploy notification
       })
```

### Email → LinkedIn Cross-Channel Sequencing
```
EmailBison sends EMAIL_SENT webhook →
  Webhook handler (existing) →
    1. Record WebhookEvent (existing)
    2. Update person status (existing)
    3. NEW: Look up CampaignSequenceRules matching:
       - campaignName + triggerEvent === 'email_sent' + triggerStepRef matches
    4. For each matching rule:
       - Compile messageTemplate with Handlebars (lead context)
       - Assign sender (email_match mode)
       - Schedule action: now + delayMinutes
       - enqueueAction() with sequenceStepRef
```

### Connection Accept Polling
```
Railway Worker (every 2 hours) →
  For each workspace:
    Get pending connections (LinkedInConnection.status === 'pending') →
      For each: check_connection via VoyagerClient →
        If connected:
          Update LinkedInConnection.status → 'connected'
          Look up next CampaignSequenceRule (triggerEvent === 'connection_accepted')
          Compile template, enqueue follow-up with delay
        If timeout (>14 days):
          Withdraw request
          After 48h cooldown: retry once
        If declined:
          Mark 'connection_failed', skip remaining LinkedIn steps
```

### Recommended File Structure
```
src/
├── lib/
│   ├── campaigns/
│   │   ├── operations.ts        # Existing — add deploy operations
│   │   └── deploy.ts            # NEW — deploy pipeline logic
│   ├── emailbison/
│   │   ├── client.ts            # Extend with createSequenceStep
│   │   └── types.ts             # Extend with SequenceStep create types
│   ├── linkedin/
│   │   ├── queue.ts             # Existing — used as-is
│   │   ├── sender.ts            # Existing — used as-is
│   │   ├── sequencing.ts        # NEW — sequence rule evaluation + template compilation
│   │   └── connection-poller.ts # NEW — connection accept detection
│   └── notifications.ts         # Extend with notifyDeploy
├── app/api/
│   ├── campaigns/[id]/
│   │   ├── deploy/route.ts      # NEW — deploy trigger endpoint
│   │   └── deploys/route.ts     # NEW — deploy history endpoint
│   └── webhooks/emailbison/
│       └── route.ts             # Extend with sequence rule triggering
```

### Anti-Patterns to Avoid
- **Synchronous deploy in API route**: Must use waitUntil() or similar. Deploy can take 30-60s for large lead lists (serial EB API calls with rate limiting). Never block the response.
- **Missing dedup on re-deploy**: Campaign.status === 'deployed' is the mutex. CampaignDeploy records provide audit trail. Never create duplicate EB campaigns.
- **Polling from Vercel cron for connection checks**: 2-hour polling needs the Railway worker, not Vercel's daily cron. Connection accept detection must be frequent.
- **Sending all LinkedIn actions at once for LinkedIn-only campaigns**: Must stagger with delays between steps per lead, same as email gap model.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Template compilation | Custom regex replacer | Handlebars npm package | Handles conditionals, escaping, helpers. One-line compile + execute. |
| Exponential backoff | Custom retry loop | Simple utility function | 3 retries with [1s, 5s, 15s] delays. Not complex enough for a library. |
| Background execution | Custom queue/worker | Vercel waitUntil() | Built into Next.js server context. Fire-and-forget with error handling. |

## Common Pitfalls

### Pitfall 1: EmailBison Rate Limiting
**What goes wrong:** Pushing hundreds of leads in rapid succession hits EB's rate limit (429).
**Why it happens:** EB API has per-workspace rate limits.
**How to avoid:** Serial lead creation with small delay (100ms between calls). The existing EmailBisonClient already throws RateLimitError with retryAfter header.
**Warning signs:** 429 responses from EB API.

### Pitfall 2: EmailBison No Campaign-Lead Assignment API
**What goes wrong:** Leads are created but not assigned to the campaign.
**Why it happens:** EB has no API endpoint for campaign-lead assignment (confirmed in Phase 7 spike, returns 405).
**How to avoid:** Accept this limitation. Leads are pushed to the workspace; campaign assignment is manual in EB UI. Document this in deploy notification.
**Warning signs:** N/A — known limitation.

### Pitfall 3: Webhook Event Matching
**What goes wrong:** EMAIL_SENT webhook doesn't carry enough context to match the right CampaignSequenceRule.
**Why it happens:** EB webhook payload has campaign_id (EB's int ID) and sender_email — need to map back to Outsignal campaign.
**How to avoid:** Store Campaign.emailBisonCampaignId on deploy. Match webhook data.campaign.id to this. Also match the sequence step reference (e.g., position) from the email step.
**Warning signs:** Sequence rules firing for wrong campaign or wrong step.

### Pitfall 4: Handlebars XSS in LinkedIn Messages
**What goes wrong:** Template compilation includes HTML entities or escaping.
**Why it happens:** Handlebars auto-escapes by default.
**How to avoid:** Use triple-brace `{{{variable}}}` in templates or compile with `noEscape: true`. LinkedIn messages are plain text — no HTML needed.
**Warning signs:** `&amp;` or `&#x27;` appearing in LinkedIn messages.

### Pitfall 5: Connection Timeout Race Condition
**What goes wrong:** A connection request is withdrawn and retried, but the original request was accepted between the withdraw and the re-check.
**Why it happens:** LinkedIn's accept/decline is asynchronous.
**How to avoid:** Check connection status before withdrawing. Use conservative timeouts (14 days before withdraw, 48h cooldown before retry). Only retry once.
**Warning signs:** Duplicate connection requests.

### Pitfall 6: Vercel waitUntil() Timeout
**What goes wrong:** Large deployments exceed Vercel's function execution limit.
**Why it happens:** Vercel Hobby plan has 60s limit; Pro has 300s. waitUntil() runs within the same function context.
**How to avoid:** The project has `maxDuration = 300` on the chat route. Set the same on the deploy route. For very large lists (>500 leads), consider chunking or moving to Railway.
**Warning signs:** Deploy marked as failed mid-way.

## Code Examples

### waitUntil Pattern (Next.js 16)
```typescript
import { after } from 'next/server';

export async function POST(request: Request) {
  // Validate and create CampaignDeploy record...

  after(async () => {
    // This runs after the response is sent
    await executeDeploy(campaignId, deployId);
  });

  return NextResponse.json({ deployId, status: 'pending' });
}
```

Note: In Next.js 15+, `after()` replaces the old `waitUntil()` pattern. Import from `next/server`.

### Handlebars Template Compilation
```typescript
import Handlebars from 'handlebars';

function compileTemplate(template: string, context: Record<string, unknown>): string {
  const compiled = Handlebars.compile(template, { noEscape: true });
  return compiled(context);
}

// Usage:
const message = compileTemplate(
  "Hi {{firstName}}, I saw you're at {{companyName}}.{{#if emailOpened}} Looks like you saw my email about {{emailSubject}}.{{/if}} Would love to connect!",
  { firstName: "John", companyName: "Acme", emailOpened: true, emailSubject: "partnership opportunity" }
);
```

### EmailBison Sequence Step Creation
```typescript
// Extend EmailBisonClient
async createSequenceStep(
  campaignId: number,
  step: { position: number; subject?: string; body: string; delay_days?: number }
): Promise<SequenceStep> {
  const res = await this.request<{ data: SequenceStep }>(
    `/campaigns/${campaignId}/sequence-steps`,
    {
      method: 'POST',
      body: JSON.stringify(step),
      revalidate: 0,
    }
  );
  return res.data;
}
```

### Deploy Retry with Exponential Backoff
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delays: number[] = [1000, 5000, 15000],
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      const delay = delays[Math.min(attempt, delays.length - 1)];
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `waitUntil()` from Vercel | `after()` from next/server | Next.js 15 | Use `after()` — it's the stable API for background work after response. |
| Auto-deploy on approval | Manual deploy button | CONTEXT.md (user decision) | Deploy triggered by admin, not by approval webhook. |
| Browser automation for LinkedIn | VoyagerClient HTTP API | Phase 11 (complete) | All LinkedIn actions go through VoyagerClient. No browser. |

## Open Questions

1. **EmailBison Sequence Step API Verification**
   - What we know: The EB API has GET /campaigns/{id}/sequence-steps (used in Phase 7 spike). POST likely exists but was not explicitly tested.
   - What's unclear: Exact POST payload structure for creating sequence steps.
   - Recommendation: Create step creation method based on SequenceStep type (position, subject, body, delay_days). If POST fails, fall back to creating campaign with steps via campaign duplication.

2. **Vercel `after()` in Route Handlers**
   - What we know: `after()` is available in Next.js 15+ from `next/server`. The project uses Next.js 16.
   - What's unclear: Whether `after()` has the same timeout as the route handler's maxDuration.
   - Recommendation: Set `maxDuration = 300` on the deploy route. If after() inherits this, 5 minutes is sufficient for most deployments (100-500 leads at ~100ms per EB API call).

3. **Connection Accept Polling Interval**
   - What we know: CONTEXT.md says "poll every 2 hours via Railway worker".
   - What's unclear: Whether the existing worker poll loop (which processes action queues) should also handle connection checking, or if it's a separate loop.
   - Recommendation: Add connection polling as a separate interval in the worker's main loop. Every N ticks (where N * poll_interval ≈ 2 hours), run the connection check cycle.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: prisma/schema.prisma (CampaignSequenceRule model already exists)
- Codebase analysis: src/lib/emailbison/client.ts (createCampaign, createLead methods)
- Codebase analysis: src/lib/linkedin/queue.ts (enqueueAction with full params)
- Codebase analysis: src/lib/campaigns/operations.ts (state machine, approval flow)
- Codebase analysis: src/app/api/webhooks/emailbison/route.ts (EMAIL_SENT handling)
- Codebase analysis: worker/src/worker.ts (VoyagerClient integration, action execution)

### Secondary (MEDIUM confidence)
- Next.js after() API — based on Next.js 15+ docs. Project uses Next.js 16.
- Handlebars npm — stable library, v4.7+. Well-established for template compilation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All core libraries already exist in codebase
- Architecture: HIGH - Building on established patterns (queue, notifications, operations)
- Pitfalls: HIGH - Based on direct codebase analysis of existing EmailBison integration and webhook handling

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days — stable domain, no external API changes expected)
