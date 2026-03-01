# Phase 8: Campaign Entity + Writer Integration - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Campaign becomes a first-class entity that owns leads (TargetList) and content (email + LinkedIn sequences). Writer agent generates sequences and reply suggestions. Admin creates campaigns, generates content, iterates, and promotes to client review — all through Cmd+J chat. Knowledge base search upgrades to pgvector embeddings.

</domain>

<decisions>
## Implementation Decisions

### Campaign data model
- Sequences stored as JSON columns on Campaign: `emailSequence` and `linkedinSequence`
- One TargetList per Campaign (1:1 via `targetListId`) — different audiences = different campaigns
- Status transitions enforced via a transition map (state machine): draft → internal_review → pending_approval → approved → deployed → active → paused → completed. Invalid transitions return an error.
- Channel selection as enum array field: `channels` with values `['email']`, `['linkedin']`, or `['email', 'linkedin']`
- Separate approval fields for leads and content (approved/feedback/timestamp for each)

### Writer content generation — outbound sequences
- Default 3-step email sequences (initial + 2 follow-ups). Admin can request more/fewer.
- One angle per generation. Admin says "write another angle" to get a variant for A/B testing.
- LinkedIn structure: blank connection request (no note) + 2 message follow-ups
- Writer auto-searches knowledge base for relevant best practices when generating content — no admin action needed
- Generates both subject line and body for each email step
- Style rules hardcoded globally in writer system prompt (not per-workspace)
- Smart iteration: feedback about a specific step ("step 2 is too long") regenerates that step only; general feedback ("too formal") regenerates all steps
- Merge tokens use uppercase with single curly braces: `{FIRSTNAME}`, `{COMPANYNAME}`, etc.

### Writer quality rules (hardcoded)
1. All emails under 70 words
2. No em dashes
3. No exclamation marks in subjects
4. Subject lines 3-6 words, lowercase
5. Soft CTAs only (questions)
6. No banned phrases
7. Variables uppercase, single curly braces
8. Only confirmed variables used
9. PVP framework (Relevance → Value → Pain)
10. Spintax 10-30%, no stats/CTAs/variables spun
11. All spintax options grammatically correct

### Reply suggestion behavior
- Trigger on all reply webhooks (LEAD_REPLIED and LEAD_INTERESTED) — not just interested
- Suggested response appears as inline block below the reply preview in Slack notification
- Reply style uses a subset of quality rules: no em dashes, under 70 words, simple language. Does NOT use PVP framework or spintax (those are for cold outreach, not conversation replies)
- Context for generating reply: full thread (original outbound + lead's reply), workspace/client context, and auto-searched knowledge base

### Campaign creation UX in Cmd+J
- Agent confirms campaign details (name, list, channels) before creating — shows preview, admin confirms
- Content generation is a separate explicit step — admin says "write email sequence" after campaign creation. Not auto-generated on create.
- "Push for approval" transitions status to pending_approval and fires client notification (email + Slack) with portal link
- Campaign context tracked implicitly from conversation — "write sequence" applies to last-mentioned campaign without requiring explicit reference

### Claude's Discretion
- Exact Prisma schema field names and types beyond what's specified above
- Campaign naming conventions (auto-generated vs admin-provided)
- pgvector embedding model and dimensions for knowledge base upgrade
- Slack notification block layout details
- Error handling for writer failures (retry, fallback message, etc.)

</decisions>

<specifics>
## Specific Ideas

- Writer quality check rules come from an existing system (screenshot provided) — these are non-negotiable production rules, not suggestions
- LinkedIn connection requests should be blank (no note) because blank requests have higher accept rates in cold outreach
- Reply suggestions should feel human and conversational, not like templated outbound
- PVP framework (Relevance → Value → Pain) is the structural backbone for all outbound email copy

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-campaign-entity-writer*
*Context gathered: 2026-03-01*
