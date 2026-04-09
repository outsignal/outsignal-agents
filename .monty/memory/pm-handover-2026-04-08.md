# PM Handover — 2026-04-08 (Campaign Session)

## Priority 1: Batch Re-Verify Script (Blocks E4+E5 email campaigns)

**Build `scripts/batch-reverify.ts`:**
- Accepts `--workspace` and `--campaignName` (or `--listId`)
- Reads target list leads that have existing emails
- Calls `verifyEmail(email, personId)` from `src/lib/verification/bounceban.ts` directly — DO NOT run the full enrichment waterfall (we already have the emails, don't burn FindyMail/Prospeo credits)
- Falls back to Kitt for "unknown" results via `src/lib/verification/kitt.ts`
- Overwrites stale LeadMagic verification data on the Person record
- Reports: valid/invalid/risky/catch_all/unknown breakdown
- Removes invalid leads from the target list after verification

**Run against:**
- `Lime Recruitment - Email - E4 - Factory Manager` (77 leads, original 6.1% bounce)
- `Lime Recruitment - Email - E5 - Shift Manager` (309 leads, original 10.8% bounce)
- Estimated cost: ~$1.93 (386 emails × $0.005 BounceBan)

**Context:** These campaigns were paused due to high bounce rates caused by LeadMagic verification (now cancelled). BounceBan is the current primary verifier. The existing BounceBan module (`src/lib/verification/bounceban.ts`) has `verifyEmail(email, personId)` ready to go — just needs a batch wrapper.

## Priority 2: Prospeo Adapter Compiled Dist Bug

The compiled `dist/cli/search-prospeo.js` has two issues vs source:
1. **Seniority values sent lowercase** (`manager`) but Prospeo API requires capitalised (`Manager`) — causes filter to be ignored
2. **Location filter may not be applied correctly** — C2/C3 discovery returned 15+ overseas leads (US, Australia, India) despite `"United Kingdom #GB"` location being specified

Running via `npx tsx` on source files works correctly. Either rebuild dist or add defensive capitalisation/validation in the adapter before sending to the API.

## Priority 3: Deploy Notification Template

When a LinkedIn-only campaign deploys, the notification shows "LEADS: 0 pushed" which looks like a failure. This is the email lead count (correct at 0 for LinkedIn-only). Options:
1. Hide the LEADS section when campaign has no email channel
2. Relabel as "EMAIL LEADS: 0 (not applicable)"

Low priority, cosmetic.

## Priority 4: Deployed → Active Auto-Transition

The deploy API (`POST /api/campaigns/[id]/deploy`) transitions campaign to `deployed` status, but nothing auto-transitions to `active` after a successful deploy. Campaigns get stuck at `deployed` until manually set to `active`. 

Fix: In `executeDeploy()` (or the Trigger.dev `campaign-deploy` task), auto-transition to `active` when `finalizeDeployStatus` sets the deploy record to `complete`.

## Priority 5: Apollo 403

Apollo API returns 403 on people search. We don't have a paid subscription ($49/mo). Not critical — Prospeo + AI Ark provide sufficient coverage. Either:
- Remove Apollo from default discovery sources
- Or subscribe if budget allows

## Priority 6: Connection Poller — Lime

Lucy Marshall (lime-recruitment) has 23 connections sent over 8 days but 0 acceptances recorded. Either:
- Nobody has accepted yet (possible but unusual)
- The connection poller isn't picking up acceptances for Lime

Monty already flagged an `actionType` bug fix (`connection_request` matching in 7 files) — this may resolve it after the next deploy. Verify after push.

## Priority 7: OOO Campaign Page Crash

The campaign page crashes when loading `Lime Recruitment - Email - OOO Welcome Back` (ID: `cmnq5nivc0001p8534g0k4wr6`). Error: "Something went wrong loading this page".

**Root cause (likely):** The `emailSequence` JSON uses `bodyText`/`bodyHtml` fields, but working campaigns (e.g. E1) use a `body` field. The dashboard campaign detail component probably expects `body` and crashes on the mismatch.

**Fix:** Either normalise the `emailSequence` format to match E1 (use `body` instead of `bodyText`/`bodyHtml`), or update the dashboard component to handle both formats. Also worth checking: the campaign `type` was `ooo_reengage` (changed to `static` as a workaround) — the page may not handle non-standard types.

Campaign record: `cmnq5nivc0001p8534g0k4wr6`, workspace: `lime-recruitment`.

## Priority 8: Writer Rules Update (Already Done — FYI)

Rules 13+14 added to `.claude/rules/writer-rules.md`:
- Rule 13: Zero links in cold outreach (automatic rejection)
- Rule 14: Zero images in cold outreach (automatic rejection)

No action needed from Monty — just awareness that the rules file changed.
