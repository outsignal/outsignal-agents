# Domain Pitfalls: Channel Adapter Refactoring

**Domain:** Multi-channel outbound adapter architecture retrofit
**Researched:** 2026-04-08
**Overall confidence:** HIGH (evidence-based from codebase analysis + 6 confirmed bugs from recent session)

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or silent failures at production scale.

### Pitfall 1: String Enum Sprawl Across Files (ALREADY HIT)

**What goes wrong:** Action types, channel names, and status strings are raw strings compared with `===` across 36+ files. When the canonical value changes or a new variant is added, some files get updated and others silently break. The system appears to work because no errors are thrown -- the comparisons just evaluate to `false` and skip the code path.

**Why it happens:** TypeScript's type system does not enforce string literal unions at the Prisma boundary. Prisma schema uses `String` not `enum`, so any string is accepted. Developers copy-paste comparisons like `actionType === "connect"` without a shared constant. Over time, the same concept gets different string representations: `"connect"` vs `"connection_request"`, `channel: "email"` vs missing the `"both"` case.

**Evidence from THIS codebase:**
- `actionType === "connect"` mismatch found in 7 files (just fixed today)
- `channel: 'linkedin'` queries missing `channel: 'both'` senders (documented in live-data-rules.md)
- LinkedIn queue uses `actionType: { in: ["connect", "connection_request"] }` -- a workaround for the inconsistency (line 253, 274 in queue.ts)

**Consequences:** Silent data exclusion. LinkedIn campaigns showed blank in portal. Deploy notifications reported "LEADS: 0" for LinkedIn campaigns. Connection poller dropped pending connections.

**Prevention:**
1. Create a `src/lib/channels/constants.ts` file with ALL string enums as TypeScript const objects exported from a single source of truth
2. Replace every raw string comparison with a reference to these constants
3. Add a `grep` lint step (or ESLint rule) that flags raw channel/actionType string literals outside the constants file
4. For Prisma queries involving `channel`, create helper functions like `isLinkedInSender(channel: string)` that encapsulate the `in: ["linkedin", "both"]` pattern

**Detection:** Search for `=== "connect"`, `=== "email"`, `=== "linkedin"`, `channel:` in Prisma `where` clauses. Any raw string comparison on a channel-related field is a suspect. Run `grep -rn 'actionType === \|channel === ' src/` periodically.

**Phase to address:** Phase 1 (foundation) -- this must be fixed BEFORE any adapter work begins, because the adapter interface will define canonical values that every consumer must use.

---

### Pitfall 2: EmailBison IDs Hardwired Into Campaign Identity

**What goes wrong:** The Campaign model uses `emailBisonCampaignId` and `emailBisonSequenceId` as direct fields, and 10 files reference these 38 times. Code paths use these IDs to fetch leads, link replies, and look up analytics. When introducing an adapter layer, these EmailBison-specific IDs must be abstracted but cannot be removed (backward compatibility), creating a split-brain where some code uses the adapter and some still reaches for the raw EB IDs.

**Why it happens:** The system was built email-first, and EmailBison was the only campaign backend. Storing the EB campaign ID directly on the Campaign model was the simplest correct design at the time. Now every feature that touches campaigns has a dependency on EmailBison's data model.

**Evidence from THIS codebase:**
- `emailBisonCampaignId` referenced in 10 files, 38 occurrences
- Reply model has `emailBisonReplyId` as a unique field for dedup
- `CampaignDeploy` model has its own `emailBisonCampaignId`
- Webhook handler (`/api/webhooks/emailbison/route.ts`) uses EB campaign IDs to look up Outsignal campaigns
- Analytics snapshot (`snapshot.ts`) queries EmailBison API by these IDs

**Consequences:** If the adapter hides EmailBison behind an interface but some code paths still directly use `campaign.emailBisonCampaignId`, you get:
- Two sources of truth for campaign identity
- Webhook handlers that bypass the adapter entirely
- Analytics that only work for the email channel
- Reply linking that fails for non-email channels

**Prevention:**
1. Map EmailBison IDs into a generic `channelCampaignRef` concept -- a per-channel external reference stored in a separate table (e.g., `CampaignChannelRef { campaignId, channel, externalId, externalSequenceId }`)
2. Keep `emailBisonCampaignId` on the Campaign model as deprecated (nullable), but all new code must use the adapter's `getExternalRef()` method
3. Migrate existing data in a single migration that copies EB IDs into the new table
4. Add a `@deprecated` JSDoc comment on `emailBisonCampaignId` and a lint warning

**Detection:** Any `import` of `emailBisonCampaignId` or direct Prisma query on this field outside the EmailAdapter is a violation.

**Phase to address:** Phase 1-2 -- define the abstraction in Phase 1, migrate the data in Phase 2, enforce usage in Phase 3.

---

### Pitfall 3: Adapter Interface That Is Too Email-Shaped

**What goes wrong:** When building the adapter interface, the initial design unconsciously mirrors EmailBison's API shape: sequences with subject lines, open tracking, bounce rates, sender rotation. LinkedIn does not have subject lines, open tracking, or bounce rates. Future channels (cold calls, paid ads) have entirely different concepts. The adapter becomes a leaky abstraction where non-email adapters return `null` or throw `NotSupported` for half the interface.

**Why it happens:** The team has deep mental models of EmailBison's data. It is the path of least resistance to design `ChannelAdapter.getMetrics()` to return `{ openRate, replyRate, bounceRate }` because that is what the dashboard already displays. LinkedIn metrics (accept rate, message reply rate) do not map cleanly.

**Evidence from THIS codebase:**
- `CachedMetrics` model stores generic `metricType` + `data` JSON, which is good -- but the actual metric types are email-centric (`"campaign_performance"`, `"sender_health"`)
- Analytics snapshot runs `EmailBisonClient.getCampaignStats()` directly
- Dashboard sparkline was reusing email data source for LinkedIn "Connections Made" stat (bug #4)
- Portal campaign detail was entirely EmailBison-dependent -- LinkedIn showed blank (bug #2)
- Copy quality validation has `channel === "linkedin"` branches bolted on to an email-first validator

**Consequences:**
- Non-email adapters become second-class citizens with degraded functionality
- Dashboard shows empty tiles for LinkedIn metrics because the adapter interface assumes email-shaped data
- Feature parity becomes a never-ending chase: every new dashboard widget needs per-channel implementations

**Prevention:**
1. Design the adapter interface from the NARROWEST common contract: `deploy()`, `pause()`, `resume()`, `getLeads()`, `getActions()`. Channel-specific metrics are optional extensions, not required interface members.
2. Use a capability flags pattern: `adapter.capabilities()` returns `{ hasOpenTracking: boolean, hasBounceRate: boolean, hasAcceptRate: boolean }`. UI renders conditionally based on capabilities.
3. Define a `ChannelMetric` union type: `{ type: "open_rate", value: number } | { type: "accept_rate", value: number } | ...` -- consumers pattern-match on type, not assume all metrics exist.
4. Test the interface by writing the LinkedIn adapter FIRST (not the email adapter). If the interface feels awkward for LinkedIn, it is too email-shaped.

**Detection:** Any adapter interface method that includes "subject", "open", "bounce", or "sender rotation" in its signature is likely too email-specific.

**Phase to address:** Phase 1 (interface design) -- get this wrong and every subsequent phase inherits the leaky abstraction.

---

### Pitfall 4: Dual-Write Window During Migration

**What goes wrong:** During the transition period, some features read from the old EmailBison-direct path while others read from the new adapter path. Data written through one path is not visible through the other. Deploys work but analytics break. Webhook handlers create records that the adapter does not surface. The system is in a half-migrated state where both paths are active, and neither is complete.

**Why it happens:** Migrating 65 files with 297 EmailBison references cannot happen in a single commit. The migration must be phased. But during the phased rollout, the old and new code paths coexist, and there is no enforcement mechanism to prevent the old path from being used.

**Evidence from THIS codebase:**
- 65 files reference EmailBison directly (grep count)
- Webhook handler creates Reply records with `emailBisonReplyId` -- these must continue working during migration
- Analytics snapshot queries EmailBison API and writes to CachedMetrics -- if an adapter-based analytics path is introduced alongside, both will run
- Notification system reads from Reply/WebhookEvent -- these are downstream of the webhook handler, not the adapter

**Consequences:**
- Metrics double-counted or missing depending on which path is active
- Deploys succeed through adapter but analytics still query old path (stale data)
- Notifications fire twice (once from webhook handler, once from adapter) or not at all

**Prevention:**
1. Feature flag the adapter: `USE_CHANNEL_ADAPTER=true` on a per-workspace basis. A workspace is either fully on the old path OR fully on the new path, never both.
2. The adapter wraps the existing code, not replaces it. `EmailAdapter.deploy()` internally calls the same `deployEmailChannel()` function that exists today. This means the adapter starts as a thin wrapper, not a rewrite.
3. Define a migration checklist per workspace: webhook handler migrated, analytics migrated, notifications migrated, deploy migrated. Track completion.
4. Add a "compatibility shim" period where the adapter reads from both old and new data sources and logs discrepancies. Fix discrepancies before removing the old path.

**Detection:** Any workspace where `USE_CHANNEL_ADAPTER=true` but any code path still directly references `EmailBisonClient` outside the adapter is a violation.

**Phase to address:** Phase 2-3 -- implement the wrapper in Phase 2, migrate consumers in Phase 3, remove old path in Phase 4.

---

### Pitfall 5: Portal Hardcoded to EmailBison (ALREADY HIT)

**What goes wrong:** The client portal was built assuming all campaigns are email campaigns with EmailBison data. Campaign detail pages, activity feeds, lead lists, and analytics all query EmailBison directly. When LinkedIn campaigns are viewed in the portal, they show blank pages, zero leads, and no activity.

**Why it happens:** The portal was built during v1.1 when only email existed. When LinkedIn was added, the portal was not updated because LinkedIn was primarily an admin-facing feature. But clients running LinkedIn-only campaigns (BlankTag) see a broken portal.

**Evidence from THIS codebase:**
- Portal campaign detail was entirely EmailBison-dependent (bug #2, just fixed)
- Portal files: `portal/campaigns/page.tsx`, `portal/campaigns/[id]/page.tsx`, `portal/activity/activity-log.tsx` -- all had EmailBison dependencies
- `portal/campaigns/[id]/leads/route.ts` uses `emailBisonCampaignId` to fetch leads (3 occurrences)
- `portal/sender-health/page.tsx` queries senders with `channel: { in: ["linkedin", "both"] }` -- at least this one was correct

**Consequences:**
- Client sees blank campaign pages for LinkedIn campaigns
- Client cannot review LinkedIn leads or activity
- Client loses confidence in the platform

**Prevention:**
1. The portal MUST consume the adapter interface, not the EmailBison client directly
2. Every portal page needs a "channel tabs" component (already partially exists as `campaign-channel-tabs.tsx`) that renders per-channel data
3. Portal feature parity test: for every email portal feature, verify LinkedIn equivalent exists and displays correctly
4. Add an integration test that renders a LinkedIn-only campaign in the portal and asserts non-empty content

**Detection:** Any `import` of `EmailBisonClient` or direct EB API query in `/app/(portal)/` code is a violation after migration.

**Phase to address:** Phase 3 (portal unification) -- but validate with a test matrix in Phase 1 planning.

---

## Moderate Pitfalls

### Pitfall 6: Testing Gaps at the Adapter Boundary

**What goes wrong:** Tests mock the adapter interface but never test the actual EmailBison adapter implementation against real API responses. Or: tests exercise the email adapter thoroughly but the LinkedIn adapter has zero test coverage. The adapter contract is tested but the implementations are not.

**Why it happens:** Adapter tests are written for the interface (easy to mock), not the implementations (require API fixtures). The email adapter gets tested because it wraps existing code that already worked. The LinkedIn adapter is new and lacks fixtures.

**Evidence from THIS codebase:**
- `src/__tests__/emailbison-client.test.ts` exists (10 EmailBison references)
- `src/__tests__/linkedin-queue.test.ts` exists but tests queue logic, not campaign operations
- `src/lib/discovery/__tests__/channel-enrichment.test.ts` exists -- good pattern to follow
- No integration test for LinkedIn campaign deploy end-to-end

**Prevention:**
1. For each adapter method, write at least one test per implementation (not just the interface)
2. Create API response fixtures from real EmailBison and LinkedIn responses (anonymized)
3. Add a "portal smoke test" that loads each portal page for an email campaign, a LinkedIn campaign, and a dual-channel campaign
4. The test suite must include a "new channel checklist" test that fails if a new adapter is registered without corresponding test coverage

**Phase to address:** Every phase -- each phase's PR must include adapter-level tests for the code it introduces.

---

### Pitfall 7: Sender Model `channel` Field Tri-State Problem

**What goes wrong:** The Sender model has `channel: "email" | "linkedin" | "both"`, and every query that needs LinkedIn senders must use `channel: { in: ["linkedin", "both"] }`. This is a known footgun documented in `live-data-rules.md`. When the adapter is introduced, every adapter method that queries senders must remember this tri-state logic. If even one query uses `channel: "linkedin"` instead of `in: ["linkedin", "both"]`, it silently excludes dual-channel senders.

**Evidence from THIS codebase:**
- `live-data-rules.md` explicitly documents this as a violation pattern
- 15+ files use `channel: { in: ["linkedin", "both"] }` -- the correct pattern
- `sync-senders.ts` line 79 upgrades `"linkedin"` to `"both"` when an email is found
- `workspaces/page.tsx` uses the correct pattern: `s.channel === "linkedin" || s.channel === "both"`
- Previous violations documented: queries using `channel: 'linkedin'` that missed `both` senders

**Prevention:**
1. The adapter MUST encapsulate sender queries. `EmailAdapter.getSenders()` returns email senders (channel `email` or `both`). `LinkedInAdapter.getSenders()` returns LinkedIn senders (channel `linkedin` or `both`). No consumer ever writes this filter directly.
2. Consider refactoring to a many-to-many: `SenderChannel { senderId, channel }` junction table. A sender with two rows (`email`, `linkedin`) is easier to query than a tri-state string. This is a Phase 1 schema decision.
3. If keeping the string field: add a `sendersByChannel(channel: "email" | "linkedin")` utility that encapsulates the `in` logic and is the ONLY way to query senders by channel.

**Phase to address:** Phase 1 (schema design decision) -- either refactor to junction table or create the utility function.

---

### Pitfall 8: Notification System Assumes Email Reply Shape

**What goes wrong:** The notification system (`src/lib/notifications.ts`) was designed around email replies: subject lines, email bodies, "Reply in Outsignal" buttons linking to the inbox. LinkedIn replies do not have subject lines. LinkedIn conversations live in a different UI. If notifications are extended to LinkedIn without adapting the format, clients get confusing notifications with empty subject fields and broken links.

**Evidence from THIS codebase:**
- Notification format documented in MEMORY.md: "Email subject: `[{Workspace Name}] New Reply from {lead name or email}`"
- Reply model has `subject`, `bodyText`, `emailBisonReplyId` -- all email-centric
- "Reply in Outsignal" button links to `https://app.outsignal.ai/inbox` -- this is the email inbox, not LinkedIn
- 17 notification types exist, all wrapped with audit logging

**Prevention:**
1. Add a `channel` field to notification templates
2. LinkedIn notifications should link to the LinkedIn conversation view (different URL)
3. Subject line field should be optional in notification rendering -- LinkedIn replies do not have subjects
4. Test each notification type with both email and LinkedIn reply data

**Phase to address:** Phase 3 (notification channel awareness).

---

### Pitfall 9: Analytics Pipeline Tightly Coupled to EmailBison Stats API

**What goes wrong:** The analytics snapshot (`src/lib/analytics/snapshot.ts`) directly calls `EmailBisonClient.getCampaignStats()` and writes results to `CachedMetrics`. The Intelligence Hub, campaign rankings, and step analytics all read from these cached metrics. If the adapter introduces its own metrics pipeline, there will be two metrics sources with different update cadences, formats, and coverage.

**Evidence from THIS codebase:**
- `snapshot.ts` has 5 EmailBison references and 4 actionType references
- Dashboard stats route (`/api/dashboard/stats/route.ts`) has 7 EmailBison references
- LinkedIn analytics are computed differently -- from `LinkedInAction` completion records, not an external API
- CachedMetrics model is actually channel-agnostic (generic `metricType` + `data` JSON), which is a good foundation

**Prevention:**
1. The adapter should expose `getMetrics(): ChannelMetric[]` that each implementation fills from its own data source (EB API for email, LinkedInAction table for LinkedIn)
2. The snapshot cron calls `adapter.getMetrics()` for each active channel, not `EmailBisonClient` directly
3. CachedMetrics remains the single storage layer -- adapters write to it, dashboard reads from it
4. Add a `channel` discriminator to CachedMetrics records so email and LinkedIn metrics do not collide on the same `metricKey`

**Phase to address:** Phase 2-3 (analytics unification).

---

### Pitfall 10: Feature Parity Assumption Trap

**What goes wrong:** The team assumes every email feature must have a LinkedIn equivalent. This leads to building features LinkedIn does not need (bounce rate monitoring for LinkedIn, open tracking, sender rotation) and missing features LinkedIn uniquely requires (connection acceptance tracking, profile view sequencing, warm-up day scheduling for LinkedIn accounts).

**Evidence from THIS codebase:**
- LinkedIn has its own rate limiter (`rate-limiter.ts`) with warmup schedules for connections/messages/profile views -- completely different from email warmup
- LinkedIn has `LinkedInDailyUsage` tracking -- no email equivalent
- LinkedIn has connection polling (`connection-poller.ts`) -- concept does not exist in email
- Email has bounce monitoring (`bounce-monitor.ts`) -- concept does not exist in LinkedIn
- Email has SPF/DKIM/DMARC health -- concept does not exist in LinkedIn

**Prevention:**
1. The adapter interface must NOT force parity. Email-specific features (bounce monitoring, DNS health, open tracking) stay in the EmailAdapter. LinkedIn-specific features (connection polling, acceptance rate, daily usage limits) stay in the LinkedInAdapter.
2. Define "shared" vs "channel-specific" features explicitly in the interface design doc
3. Dashboard sections that only apply to one channel should render conditionally based on `adapter.capabilities()`
4. Resist the urge to create a `LinkedInBounceRate` metric just because email has one

**Phase to address:** Phase 1 (interface design) -- explicitly categorize features as shared vs channel-specific.

---

## Minor Pitfalls

### Pitfall 11: Import Cycle Between Adapter and Existing Client

**What goes wrong:** The `EmailAdapter` imports `EmailBisonClient`. But `EmailBisonClient` is already imported in 65 files. If any of those files also import from the adapter module (for types, constants, etc.), you get a circular dependency. TypeScript may not error on it (depending on structure), but runtime behavior becomes unpredictable.

**Prevention:** The adapter module must be a clean layer above the client. No file in `src/lib/emailbison/` should ever import from `src/lib/channels/`. Enforce this with an ESLint import restriction rule or a simple grep in CI.

**Phase to address:** Phase 1 (module structure).

---

### Pitfall 12: Webhook Handler Cannot Go Through Adapter

**What goes wrong:** The EmailBison webhook handler receives events from an external service. It cannot be refactored to use an adapter pattern because it is the adapter's INBOUND path -- data flows from EmailBison to the system, not the other way. Trying to force webhook handling into the adapter interface creates awkward "receive" methods that do not fit the adapter's "command" interface.

**Prevention:** Webhooks are NOT part of the adapter interface. The adapter handles outbound operations (deploy, pause, resume, get metrics). Inbound events (webhooks, polling results) are handled by separate event handlers that write to the same unified data model (Reply, LinkedInAction). The adapter and the webhook handler are peers, not parent-child.

**Phase to address:** Phase 1 (architecture decision) -- document this explicitly to prevent confusion later.

---

### Pitfall 13: Migration Ordering Dependencies

**What goes wrong:** Schema changes (new tables for channel references), data migrations (copying EB IDs), code changes (swapping direct calls for adapter calls), and feature flags must be deployed in a specific order. Deploying code that references a new table before the table exists crashes. Deploying the adapter before the feature flag system exists means no rollback path.

**Prevention:**
1. Phase 1: Schema + constants + interface (no behavior change)
2. Phase 2: Adapter implementations + feature flag (adapters exist but are not called by default)
3. Phase 3: Migrate consumers behind feature flag (old path still works when flag is off)
4. Phase 4: Enable flag per workspace, validate, remove old path
5. Never combine schema changes and behavior changes in the same deploy

**Phase to address:** All phases -- this is the overall migration strategy.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Interface design (Phase 1) | Too email-shaped (Pitfall 3) | Write LinkedIn adapter FIRST; if it feels awkward, interface is wrong |
| Constants extraction (Phase 1) | Missing some string literals (Pitfall 1) | Run `grep -rn` for ALL raw channel/actionType/status strings; create exhaustive list |
| Schema changes (Phase 1) | Breaking existing queries (Pitfall 13) | Additive only -- new columns/tables, never remove existing fields in Phase 1 |
| Email adapter (Phase 2) | Thin wrapper becomes thick abstraction | EmailAdapter should delegate to existing functions, not reimplement them |
| LinkedIn adapter (Phase 2) | Missing the `"both"` channel case (Pitfall 7) | Encapsulate in adapter, never let consumers write channel queries |
| Portal migration (Phase 3) | Blank pages for non-email campaigns (Pitfall 5) | Test matrix: email-only, LinkedIn-only, dual-channel campaigns |
| Analytics migration (Phase 3) | Dual metrics pipelines (Pitfall 9) | Single CachedMetrics table with channel discriminator |
| Notification migration (Phase 3) | Broken LinkedIn notification links (Pitfall 8) | Channel-aware notification templates with correct deep links |
| Consumer migration (Phase 3-4) | Dual-write inconsistency (Pitfall 4) | Feature flag per workspace; workspace is ALL-old or ALL-new, never mixed |
| Cleanup (Phase 4) | Removing deprecated fields too early | Keep `emailBisonCampaignId` as deprecated nullable until ALL consumers migrated and validated |

---

## Sources

- Direct codebase analysis: 940+ files, ~146,700 LOC
- Prisma schema: `prisma/schema.prisma` (1038+ lines, 30+ models)
- Bug evidence: 6 confirmed bugs from 2026-04-08 session (actionType mismatch, portal blank, deploy notification, sparkline data, connection poller, activity feed)
- Grep analysis: 297 EmailBison references across 65 files, 122 actionType references across 36 files, 71 files with channel filter patterns
- Project rules: `data-validation-rules.md`, `live-data-rules.md`, `api-client-rules.md`
- Confidence: HIGH -- all pitfalls grounded in actual codebase evidence and confirmed production bugs
