# Feature Landscape: Multi-Channel Adapter Architecture

**Domain:** Channel-agnostic outbound platform (adapter pattern for multi-channel campaigns)
**Researched:** 2026-04-08
**Confidence:** HIGH (based on deep knowledge of Instantly, Smartlead, Apollo, Expandi, Waalaxy, Reply.io, Lemlist, and the existing Outsignal codebase)

---

## How the Market Leaders Handle Multi-Channel

### The Two Models

The outbound platform market has converged on two architectural models for multi-channel:

**Model A: Unified Sequence (Reply.io, Lemlist, Smartlead v2)**
A single sequence timeline contains steps from ALL channels interleaved. Step 1 is email, step 2 is LinkedIn connect, step 3 is email follow-up, step 4 is LinkedIn message. The sequence engine evaluates channel-specific conditions (e.g. "only send LinkedIn message if connection was accepted") and skips/branches accordingly.

**Model B: Parallel Channel Sequences with Cross-Channel Triggers (Instantly, Expandi, Waalaxy)**
Each channel has its own sequence, but they share triggers. Email campaign runs independently, LinkedIn campaign runs independently, but cross-channel events can trigger actions in the other channel (e.g. "if email bounced, send LinkedIn connect instead"). This is simpler to build and debug.

**Outsignal currently uses Model B** -- `emailSequence` and `linkedinSequence` are separate JSON fields on Campaign, with `CampaignSequenceRule` providing cross-channel triggers (e.g. "on email_sent, fire LinkedIn connect"). This is the RIGHT model for an agency tool where clients approve email copy and LinkedIn copy separately.

### What Every Serious Platform Has

All of Instantly, Reply.io, Lemlist, Smartlead, and Apollo share these capabilities:

1. **Channel abstraction in the UI** -- campaigns show unified stats regardless of which channel produced them
2. **Per-channel sender pools** -- email inboxes rotate automatically, LinkedIn accounts are assigned per lead
3. **Cross-channel dedup** -- a person contacted via email is not also contacted via LinkedIn (unless the sequence deliberately orchestrates both)
4. **Channel-level pause/resume** -- can pause LinkedIn on a campaign without pausing email
5. **Unified reply inbox** -- replies from all channels appear in one feed
6. **Per-workspace channel enablement** -- some workspaces only use email, some use email+LinkedIn

### What Differentiates the Best

**Reply.io** -- strongest multi-channel sequence builder. Visual drag-and-drop with branching logic per channel. Conditions like "if email opened but not replied, wait 3 days then LinkedIn connect." The sequence is truly unified -- one timeline, multiple channels interspersed.

**Lemlist** -- best at per-channel analytics. Shows conversion funnels per channel with clear attribution: "42 LinkedIn connects led to 8 replies, vs 200 emails led to 6 replies." Makes channel ROI comparison trivial.

**Instantly** -- simplest model. Email-first, LinkedIn bolted on. Campaigns are fundamentally email campaigns with optional LinkedIn "touchpoints" added. This is closest to Outsignal's current model.

**Expandi + Waalaxy** -- LinkedIn-first platforms that added email. Their adapter pattern is inverted (LinkedIn is primary, email is the bolt-on). Shows that the adapter pattern works in either direction.

---

## Table Stakes

Features users expect. Missing = product feels incomplete for a multi-channel outbound tool.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|-------------|------------|------------|-------|
| **Channel adapter interface** | Common contract across channels eliminates scattered if/else channel checks | Medium | None | `getLeads()`, `getMetrics()`, `deploy()`, `pause()`, `resume()`, `getSequenceSteps()`. This is the core abstraction. |
| **Email adapter (wraps EmailBison)** | EmailBison client already exists -- wrap it to match the adapter interface | Low | Adapter interface | Thin wrapper around existing `EmailBisonClient`. Most methods map 1:1. |
| **LinkedIn adapter (wraps DB queries)** | LinkedIn actions are local DB queries -- wrap to match adapter interface | Low | Adapter interface | Wraps existing `LinkedInAction` queries + Railway worker coordination. |
| **Unified campaign metrics** | Portal and admin dashboard must show combined stats without caring which channel produced them | Medium | Both adapters | `getMetrics()` returns a common `ChannelMetrics` shape: sent, opened, replied, bounced. LinkedIn has no "opened" -- return null, not zero. |
| **Per-channel deploy status** | Deploy already tracks `emailStatus` / `linkedinStatus` separately on `CampaignDeploy` -- adapter should formalize this | Low | Both adapters | Already partially built. Adapter wraps existing `executeDeploy` logic. |
| **Workspace channel configuration** | Each client opts into channels (email, linkedin, future channels). Already exists as `package` field on Workspace. | Low | None | Current `package` field (`email` / `linkedin` / `email_linkedin` / `consultancy`) works. Adapter reads this to determine which adapters to instantiate. |
| **Channel-aware sender management** | Email inboxes and LinkedIn accounts already have different fields on the `Sender` model. Adapter surfaces them cleanly. | Low | Adapter interface | `Sender.channel` is already `email` / `linkedin` / `both`. Adapter filters by channel. |
| **Channel-aware notifications** | Reply notifications already include channel context. Adapter ensures consistent formatting. | Low | Adapter interface | Existing notification system already handles both channels. Adapter standardizes the reply source. |
| **Adapter registry / factory** | A central place to get the right adapter(s) for a workspace. `getAdapters(workspaceSlug)` returns only enabled channels. | Low | Workspace config | Simple factory: reads workspace `package`, returns appropriate adapter instances. |

## Differentiators

Features that set the product apart. Not expected, but valued.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|------------|-------|
| **Unified activity timeline** | Cross-channel activity for a person shown in one timeline: email sent, LinkedIn connect, email replied, LinkedIn message. Agency clients see the full touchpoint history regardless of channel. | Medium | Both adapters | Requires normalizing EmailBison events + LinkedInAction records into a common `ActivityEvent` shape. Portal already shows per-channel activity -- this unifies it. |
| **Cross-channel attribution** | "This reply came after 2 emails + 1 LinkedIn connect" -- attribute the conversion to the multi-channel sequence, not just the last touch. | High | Activity timeline | Requires tracking touchpoint chains across channels. Most platforms do last-touch attribution only. Multi-touch is a differentiator. |
| **Channel fallback rules** | If email bounces, automatically fire LinkedIn connect. If LinkedIn connect is not accepted within 14 days, fall back to email-only follow-up. | Medium | Both adapters, CampaignSequenceRule | `CampaignSequenceRule` already supports cross-channel triggers (`triggerEvent: "email_sent"` fires LinkedIn action). Extend with bounce/timeout fallbacks. |
| **Channel performance comparison** | Side-by-side view: "Email reply rate: 3.2%, LinkedIn reply rate: 12.4% for the same ICP." Helps agencies recommend channel mix to clients. | Medium | Unified metrics | Intelligence agent already does benchmarking. Extend to compare channels within a workspace. |
| **Per-channel sequence versioning** | Approve email copy independently from LinkedIn copy. Already built (separate `emailSequence` / `linkedinSequence` fields). Adapter preserves this separation while unifying the deploy. | Low | Already built | Current dual-approval model (leadsApproved + contentApproved) works. No change needed -- just ensure adapters respect it. |
| **Future channel extensibility** | Adapter pattern makes adding new channels (SMS, cold call tasks, paid ads retargeting) a matter of implementing a new adapter, not rewriting campaign logic. | Low (design), High (each new channel) | Adapter interface | The interface contract is the investment. Each new channel is a new adapter implementation. |

## Anti-Features

Features to explicitly NOT build. These are traps that waste engineering time or hurt the product.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Unified sequence builder (Model A)** | Outsignal is an agency tool with separate client approval for email and LinkedIn copy. A single interleaved sequence makes approval confusing ("approve steps 1, 3, 5 which are email, and steps 2, 4 which are LinkedIn"). Parallel sequences with cross-channel triggers (Model B) are cleaner for the agency use case. | Keep separate `emailSequence` and `linkedinSequence` on Campaign. Use `CampaignSequenceRule` for cross-channel orchestration. |
| **Visual sequence builder UI** | Campaign operations go through Nova CLI agents, not a drag-and-drop UI. Building a visual multi-channel sequence editor is months of UI work for a feature the admin doesn't use. | Writer agent generates sequences. Campaign agent links them. Portal shows read-only sequence view. |
| **Real-time channel switching mid-sequence** | "If prospect opens email, immediately switch to LinkedIn" requires real-time event processing. EmailBison doesn't push events in real-time. LinkedIn polling is 5-10 minute intervals. The latency makes real-time branching meaningless. | Use time-based delays (hours/days) for cross-channel triggers, not real-time event triggers. Current `CampaignSequenceRule` with `delayMinutes` is correct. |
| **Channel-specific campaign entities** | Creating separate Campaign records for email and LinkedIn sequences of the same outreach. This splits the campaign context, makes approval harder, and duplicates the target list. | One Campaign entity, multiple channel sequences. Already the current model. |
| **Generic "channel" abstraction that hides channel-specific behavior** | Channels are fundamentally different. Email has open tracking, LinkedIn has connection states. Forcing both into an identical interface loses useful information. | Adapter interface returns a common `ChannelMetrics` base type, but each adapter can return channel-specific extensions (e.g. LinkedIn adapter returns `connectionAcceptRate`). TypeScript discriminated unions or `extends`. |
| **SMS/cold call adapters now** | No client has requested these. Building adapters for theoretical channels is premature. | Design the interface to be extensible. Implement email + LinkedIn adapters only. Add new channels when there's actual demand. |

## Feature Dependencies

```
Adapter Interface (common contract)
  |
  +-- Email Adapter (wraps EmailBison)
  |     |
  |     +-- Unified Metrics (email portion)
  |     +-- Deploy via adapter (email portion)
  |
  +-- LinkedIn Adapter (wraps DB/Railway)
  |     |
  |     +-- Unified Metrics (LinkedIn portion)
  |     +-- Deploy via adapter (LinkedIn portion)
  |
  +-- Adapter Registry/Factory
        |
        +-- Workspace Channel Config (reads `package` field)
        |
        +-- Unified Activity Timeline (merges both adapters' events)
        |
        +-- Channel Fallback Rules (cross-adapter triggers)
        |
        +-- Channel Performance Comparison (cross-adapter analytics)
```

Key dependency chain: Interface -> Adapters -> Registry -> Everything else.

## Existing Code to Preserve (Not Rebuild)

These features are already built and working. The adapter pattern WRAPS them, not replaces them.

| Existing Feature | Location | Adapter Action |
|-----------------|----------|---------------|
| EmailBison API client | `src/lib/emailbison/client.ts` | Email adapter wraps this client |
| LinkedIn action queue | `LinkedInAction` model + `src/lib/linkedin/chain.ts` | LinkedIn adapter wraps these queries |
| Campaign deploy orchestrator | `src/lib/campaigns/deploy.ts` | Refactor to use adapters instead of inline EmailBison/LinkedIn logic |
| CampaignSequenceRule engine | `src/lib/linkedin/sequencing.ts` | Keep as-is. Cross-channel triggers already work. |
| Reply classification pipeline | `src/app/api/webhooks/emailbison/route.ts` + LinkedIn reply polling | Adapter normalizes reply source but classification logic stays |
| Sender model with channel field | `Sender.channel` (`email` / `linkedin` / `both`) | Adapter filters senders by channel |
| CampaignDeploy per-channel tracking | `emailStatus` / `linkedinStatus` on `CampaignDeploy` | Adapter reports deploy status per channel |
| Portal campaign views | Portal pages for stats, leads, activity, sequences | Portal reads from adapters instead of direct EmailBison/DB queries |
| Notification system | `src/lib/notifications.ts` | Already handles both channels. Minimal adapter changes. |

## MVP Recommendation

Prioritize (Phase 1 -- the adapter core):
1. **Adapter interface definition** -- the TypeScript contract that all channel adapters implement
2. **Email adapter** -- thin wrapper around EmailBisonClient
3. **LinkedIn adapter** -- thin wrapper around LinkedInAction queries
4. **Adapter registry** -- factory that returns enabled adapters for a workspace
5. **Refactor deploy to use adapters** -- `deploy.ts` calls adapters instead of inline channel logic

Defer (Phase 2 -- consumption):
6. **Portal reads from adapters** -- portal pages use adapter.getMetrics() instead of direct queries
7. **Admin dashboard reads from adapters** -- command center uses adapters for cross-channel stats
8. **Unified activity timeline** -- cross-channel event normalization

Defer (Phase 3 -- intelligence):
9. **Channel performance comparison** -- analytics comparing channel effectiveness
10. **Cross-channel attribution** -- multi-touch attribution across channels

**Rationale:** Phase 1 is pure infrastructure -- define the contract, wrap existing code, wire up deploy. Zero user-facing changes. Phase 2 makes the portal and admin dashboard consume adapters. Phase 3 adds intelligence features that create new value.

## Complexity Budget

| Feature | Estimated Effort | Risk |
|---------|-----------------|------|
| Adapter interface | 2-3 hours | Low -- pure TypeScript types |
| Email adapter | 3-4 hours | Low -- wrapping existing client |
| LinkedIn adapter | 4-6 hours | Medium -- LinkedIn metrics are scattered across LinkedInAction queries |
| Adapter registry | 1-2 hours | Low -- simple factory |
| Deploy refactor | 4-6 hours | Medium -- `deploy.ts` is the most complex file to refactor |
| Portal migration | 6-8 hours | Medium -- multiple portal pages need updating |
| Unified timeline | 4-6 hours | Medium -- event normalization across different schemas |
| Channel comparison | 3-4 hours | Low -- extends existing Intelligence agent |

Total estimated: ~30-40 hours of implementation across all phases.

## Sources

- Outsignal codebase analysis (prisma/schema.prisma, src/lib/campaigns/deploy.ts, src/lib/emailbison/client.ts, src/lib/linkedin/*)
- Domain expertise on Reply.io, Lemlist, Instantly, Smartlead, Apollo, Expandi, Waalaxy multi-channel implementations (MEDIUM confidence -- based on training data, not live verification)
- PROJECT.md milestone v10.0 specification
