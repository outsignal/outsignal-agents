# Brief: OOO Re-engagement Campaign Builder

## Goal
When someone replies with an out-of-office, we detect their return date and automatically create a personalised re-engagement campaign that:
1. Opens with a warm "welcome back" email tailored to their OOO reason
2. Continues with the follow-up steps they missed from the original campaign, rewritten to flow naturally after the OOO gap
3. Deploys to EmailBison and enrolls the person automatically on their return date + 1 day

This replaces the current approach which just re-enrolls them in an existing "Welcome Back" campaign or the original campaign.

## Current State

### What already works:
- **OOO detection**: `process-reply` classifies `out_of_office` intent, extracts return date/reason/event via Haiku (`src/lib/ooo/extract-ooo.ts`)
- **Delayed scheduling**: Creates `OooReengagement` record + schedules `ooo-reengage` task via Trigger.dev delayed runs
- **OOO task execution** (`trigger/ooo-reengage.ts`): Resolves EB lead ID, adapts copy with Haiku, finds/reuses existing campaign, enrolls lead, updates status, notifies Slack
- **EB client methods**: `createCampaign()`, `createSequenceStep()`, `attachLeadsToCampaign()`, `getSequenceSteps()` — all exist and work
- **Writer agent**: Full production agent with workspace intelligence, KB access, copy quality gates

### What needs to change:
The `ooo-reengage` task (trigger/ooo-reengage.ts) currently:
- Uses a hardcoded Haiku prompt to adapt ONE step from the original campaign
- Looks for an existing "Welcome Back" campaign or falls back to the original campaign's EB ID
- Only sends a single adapted email, not a full sequence

It needs to generate a **complete multi-step sequence** using the writer agent, create a fresh EB campaign, and deploy it.

## Architecture

### Flow (per person going OOO):

```
1. process-reply detects out_of_office intent
2. extractOooDetails → return date, reason, event name
3. Creates OooReengagement record (status: pending)
4. Schedules ooo-reengage task for returnDate + 1 day
   ─── time passes ───
5. ooo-reengage fires on schedule
6. Loads original campaign + its email sequence
7. Determines which steps the person already received vs missed
8. Calls writer agent to generate personalised re-engagement sequence:
   - Step 1: "Welcome back" opener referencing OOO reason + original campaign's value prop
   - Steps 2-N: Missed follow-up steps, rewritten to feel natural post-OOO
9. Creates new EB campaign: "Re-engage: {PersonName} - {WorkspaceName}"
10. Adds sequence steps to EB campaign
11. Enrolls the person
12. Updates OooReengagement record (status: sent, welcomeBackCampaignId)
13. Stores Campaign record locally for audit trail
14. Notifies Slack
```

### Step-by-step detail:

#### Step 6: Load original campaign context
- `OooReengagement.originalCampaignId` → `Campaign` record
- Parse `Campaign.emailSequence` (JSON string) to get all steps: `{ position, subjectLine, body, delayDays }`
- Also load `Campaign.name`, `Campaign.channel`, workspace intelligence via writer tools

#### Step 7: Determine missed steps
- The person replied with an OOO, which means they received at least step 1 (the one that triggered the reply)
- Need to know which step triggered the OOO reply:
  - Check `Reply.emailBisonSequenceStep` or `Reply.sequenceStep` if available
  - Fallback: assume step 1 triggered the OOO (most common case)
- Missed steps = all steps with position > triggering step position

#### Step 8: Writer agent generates the sequence
Call the writer agent with a specialised task prompt:

```typescript
const writerInput: WriterInput = {
  workspaceSlug,
  task: `Generate a personalised OOO re-engagement email sequence.

CONTEXT:
- Contact "${personName}" (${personEmail}) was out of office
- OOO reason: ${oooReason}${eventName ? ` (${eventName})` : ''}
- They returned on ${returnDate}
- Original campaign: "${campaign.name}"
- They received step(s) 1-${triggeringStep} before going OOO

STEP 1 - WELCOME BACK EMAIL:
Write a warm, personalised opener that:
- Acknowledges their absence naturally (NOT "I noticed you were out of office")
- References their OOO reason subtly (holiday → "hope you had a great break", illness → "hope you're feeling better", conference → "hope ${eventName || 'the conference'} was great")
- Bridges into the original campaign's value proposition
- Feels like a genuine follow-up, not automated

STEPS 2-${missedSteps.length + 1} - MISSED FOLLOW-UPS:
Rewrite these original campaign steps to flow naturally after the welcome back email. They should:
- NOT reference the OOO or absence again
- Maintain the original campaign's messaging and value props
- Adjust delay_days: step 2 = 2 days, step 3 = 3 days, step 4+ = 4 days (tighter than original since they're already warm)
- Keep the same subject line themes but make them fresh

ORIGINAL MISSED STEPS FOR REFERENCE:
${missedSteps.map(s => `Step ${s.position}: Subject: "${s.subjectLine}" | Body: ${s.body}`).join('\n')}`,
  channel: "email",
  campaignName: `Re-engage: ${personName}`,
  copyStrategy: "pvp",
};
```

The writer agent returns `WriterOutput.emailSteps[]` — a complete sequence ready to deploy.

#### Step 9-11: Create and deploy EB campaign

```typescript
// Create EB campaign
const ebCampaign = await ebClient.createCampaign({
  name: `Re-engage: ${personName} - ${workspaceName}`,
  type: "outbound",
  maxEmailsPerDay: 1,
  maxNewLeadsPerDay: 1,
});

// Add sequence steps
for (const step of writerOutput.emailSteps) {
  await ebClient.createSequenceStep(ebCampaign.id, {
    position: step.position,
    subject: step.subjectLine,
    body: step.body,
    delay_days: step.delayDays,
  });
}

// Assign a sending inbox (use same inbox as original campaign if possible)
// ... or pick healthiest inbox in workspace

// Enroll the person
await ebClient.attachLeadsToCampaign(ebCampaign.id, [ebLeadId]);
```

#### Step 13: Local Campaign record for audit trail

```typescript
await prisma.campaign.create({
  data: {
    workspaceSlug,
    name: `Re-engage: ${personName}`,
    channel: "email",
    type: "ooo_reengage",  // New campaign type
    status: "deployed",
    emailBisonCampaignId: ebCampaign.id,
    emailSequence: JSON.stringify(writerOutput.emailSteps),
    targetList: JSON.stringify([{ email: personEmail, name: personName }]),
    parentCampaignId: originalCampaign.id,  // Link to original
  },
});
```

## Schema Changes

### Campaign model — add fields:
```prisma
type        String?   // "outbound" | "ooo_reengage" | null (for backwards compat)
parentCampaignId String?  // Links re-engagement campaign to original
```

### No changes to OooReengagement model — already has all needed fields

## Files to Modify

1. **`trigger/ooo-reengage.ts`** — Major rewrite of steps 4-7. Replace the Haiku single-step adaptation with:
   - Original campaign + sequence loading
   - Missed step calculation
   - Writer agent invocation
   - EB campaign creation + sequence step creation
   - Lead enrollment
   - Local Campaign record creation

2. **`prisma/schema.prisma`** — Add `type` and `parentCampaignId` to Campaign model

3. **`src/lib/agents/writer.ts`** — May need a new tool or task type awareness for OOO re-engagement sequences. The existing writer should handle this well with a good prompt, but verify the quality gates don't reject the welcome-back opener pattern.

## Files to NOT Modify
- `trigger/process-reply.ts` — Already works perfectly. No changes needed.
- `src/lib/ooo/extract-ooo.ts` — Already works perfectly.
- Portal OOO page — Read-only, will show records created by this flow automatically.

## Edge Cases

1. **No original campaign found** — `originalCampaignId` is null or campaign deleted. Fallback: generate a generic re-engagement email using workspace intelligence only (no missed steps, just a "checking back in" single email).

2. **Original campaign has no email sequence** — LinkedIn-only campaign. Fallback: same as #1.

3. **Person received all steps** — No missed steps. Just send a single welcome-back email with a fresh angle on the value prop.

4. **Multiple OOO replies from same person** — Already handled by dedup in process-reply (reschedules existing pending record).

5. **Return date was defaulted (low confidence)** — `needsManualReview: true`. The task should still fire, but the welcome-back email should be more cautious ("wanted to follow up" rather than "welcome back from holiday").

6. **EB lead not found** — Current code already handles this (searches by email, creates if needed).

7. **Writer agent failure** — Fallback to the current Haiku single-step approach as a degraded mode. Don't block re-engagement because the writer failed.

## Sending Inbox Selection

The re-engagement email should ideally come from the **same inbox** that sent the original campaign. To do this:
- Check the original campaign's EB campaign for its assigned inboxes
- Or store `originalSenderEmail` on the OooReengagement record (from the Reply record's `toEmail` or campaign's sender)
- Fallback: use healthiest connected inbox in the workspace

## Testing

1. Create a test OOO reply manually in a dev workspace
2. Verify the full flow: detection → extraction → scheduling → writer generation → EB campaign creation → enrollment
3. Check the EB campaign in EmailBison dashboard to confirm sequence steps look correct
4. Verify the portal OOO page shows the record transitioning from "Scheduled" to "Re-engaged"
5. Check Slack notification fires

## Cost Considerations

- Writer agent uses Sonnet (via orchestrator) — ~$0.01-0.03 per invocation
- OOO extraction uses Haiku — ~$0.001 per invocation
- EB campaign creation is free (included in plan)
- Expected volume: 5-15 OOO re-engagements per week across all clients — negligible cost

## What This Enables for Clients

On the portal OOO page, clients will see:
- "Sarah Jones — Holiday until 4 Apr. Will email on 5 Apr." (pending)
- Then after re-engagement: "Sarah Jones — Re-engaged on 5 Apr with personalised 3-step sequence" (sent)

This demonstrates real AI-driven automation: we detected the absence, understood the reason, waited for the right moment, generated personalised copy, and re-engaged — all without human intervention.
