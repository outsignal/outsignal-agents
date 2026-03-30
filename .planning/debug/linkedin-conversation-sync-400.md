---
status: awaiting_human_verify
trigger: "linkedin-conversation-sync-400"
created: 2026-03-19T00:00:00Z
updated: 2026-03-19T14:00:00Z
---

## Current Focus

hypothesis: CONFIRMED (user-verified via browser Network tab) — LinkedIn has fully migrated conversations to a GraphQL endpoint. All 3 REST tiers are dead. The working endpoint is /voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=(mailboxUrn:{profileUrn}). Requires accept: application/graphql header and CSRF auth same as existing requests. Response is GraphQL shape — not normalized REST.
test: Implementing GraphQL as primary tier, keeping old DashMessenger REST as fallback (tier 2), dropping legacy /messaging/conversations (tier 3 — confirmed dead with 500).
expecting: After deploy, conversations fetch successfully returning GraphQL-parsed VoyagerConversation[] for each sender.
next_action: Deploy to Railway and verify Railway logs show successful conversation fetches via GraphQL endpoint.

## Symptoms

expected: Worker polls LinkedIn conversations every ~4 minutes (every 2nd cycle), detects new replies from prospects, creates inbox entries, and sends Slack notifications to client channels + admin.
actual: Voyager API returns HTTP 400 `{"status":400}` on the conversation fetch endpoint `voyagerMessagingDashMessengerConversations?keyVersion=LEGACY_INBOX&q=all`. No conversations are fetched, no replies detected, no notifications sent.
errors: `Voyager API error 400: {"status":400}` — LinkedIn appears to have deprecated the `LEGACY_INBOX` keyVersion parameter. After 3-tier fallback deployed: tier 1 → 400, tier 2 → 400, tier 3 → 500.
reproduction: Worker runs on Railway, polls LinkedIn on every 2nd cycle (~4 min). The conversation check triggers the broken endpoint. Observable in Railway logs.
started: 2026-03-19. Message sending still works fine. Only conversation fetching (reply detection) is broken.

## Eliminated

- hypothesis: Only tier 1 (LEGACY_INBOX on new DashMessenger endpoint) was broken; other tiers would work
  evidence: Railway logs show all 3 tiers fail: tier 1 → 400, tier 2 → 400, tier 3 → 500
  timestamp: 2026-03-19T12:00:00Z

- hypothesis: The new DashMessenger endpoint accepts q=all without keyVersion
  evidence: Tier 2 `/voyagerMessagingDashMessengerConversations?q=all` also returns 400 — this endpoint no longer accepts q=all as a finder at all
  timestamp: 2026-03-19T12:00:00Z

## Evidence

- timestamp: 2026-03-19T12:00:00Z
  checked: Railway logs (live)
  found: "LEGACY_INBOX endpoint failed, trying without keyVersion... DashMessenger failed, trying legacy messaging endpoint... Conversation check failed for Jonathan: Voyager API error 500: {"data":{"status":500},"included":[]}"
  implication: All 3 tiers fail. Tier 3 returns 500 (not 400), meaning a different error on the legacy endpoint — not deprecation but malformed request.

- timestamp: 2026-03-19T12:00:00Z
  checked: Beeper linkedin Python bridge (beeper/linkedin master branch, actively maintained production code)
  found: Correct legacy endpoint is `/messaging/conversations?keyVersion=LEGACY_INBOX&createdBefore={epoch_ms}`. Does NOT use `count` param. Does NOT use `q=all`.
  implication: Our tier 3 fallback uses `/messaging/conversations?count=${limit}` — missing `keyVersion=LEGACY_INBOX` (required), wrong param (`count` not valid). This causes the 500.

- timestamp: 2026-03-19T12:00:00Z
  checked: nsandman/linkedin-api (fork of tomquirk, Python)
  found: Also confirms `/messaging/conversations?keyVersion=LEGACY_INBOX` as the working endpoint for get_conversations.
  implication: Both major open-source LinkedIn Voyager clients agree on the correct endpoint.

- timestamp: 2026-03-19T12:00:00Z
  checked: parseConversations in voyager-client.ts
  found: Parser handles normalized format (data.data["*elements"] URN list + included[] entity map). It also has a fallback to scan included[] for MessengerConversation types. However, the legacy /messaging/conversations endpoint returns `{ elements: [...], paging: {...} }` at top level — NOT under data.data and NOT in included[].
  implication: Even if tier 3 was called with the right URL, the parser would return 0 conversations because it doesn't handle top-level `elements[]`.

## Resolution

root_cause: LinkedIn fully migrated conversations from all REST endpoints to a GraphQL endpoint (/voyagerMessagingGraphQL/graphql). All 3 REST tiers in the fallback chain are dead (400, 400, 500). The working endpoint requires the sender's fsd_profile URN as mailboxUrn, and the Accept: application/graphql header. The response shape is completely different from the normalized REST format — inline participant objects with distance:"SELF" marker, and messages embedded directly in each conversation element.

fix: Replaced the 3-tier REST fallback in fetchConversations() with GraphQL as primary tier (using getSelfUrn() which already caches the sender URN) and old DashMessenger REST as tier 2 fallback. Added parseGraphQLConversations() to handle the new response shape. Removed parseLegacyConversations() (dead code). Updated keepaliveFetchMessaging() to use the GraphQL endpoint. TypeScript check passes — zero errors.

verification: Deployed to Railway — awaiting log confirmation of successful conversation fetches.
files_changed:
  - worker/src/voyager-client.ts
