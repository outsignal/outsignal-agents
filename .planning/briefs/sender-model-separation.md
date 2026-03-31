# Brief: Sender Model — Email/LinkedIn Separation

## Problem

The `Sender` model is a single polymorphic table serving both email inboxes (synced from EmailBison) and LinkedIn accounts with **no type discriminator**. The codebase uses `emailBisonSenderId: null` as a proxy for "this is a LinkedIn sender", which breaks when a person is both an email sender and a LinkedIn account (dual-purpose).

### Impact today
- Lucy Marshall (lime-recruitment) and Daniel Lazarus (1210-solutions) are dual-purpose senders — they have both `emailBisonSenderId` AND LinkedIn credentials. They were **invisible** on all LinkedIn views (portal, admin, senders API) because every query filtered with `emailBisonSenderId: null`.
- The workspaces overview page counts dual-purpose senders as email-only, hiding their LinkedIn presence entirely.
- `sync-senders` (Trigger.dev task) can accidentally merge a LinkedIn-only record with an EmailBison inbox if they share the same name, creating unintended dual-purpose records.

## Current State

- **230 total senders**: 221 pure email, 7 pure LinkedIn, 2 dual-purpose
- **6 locations** use `emailBisonSenderId: null` as the LinkedIn discriminator
- **Hotfixes already applied** (in this session, uncommitted): removed `emailBisonSenderId: null` from portal LinkedIn page and senders API route. These unblock the immediate issue but don't fix the root cause.

## Scope

### 1. Add `channel` enum to Sender model

**Schema change** in `prisma/schema.prisma`:

```prisma
enum SenderChannel {
  email
  linkedin
  both
}

model Sender {
  // ... existing fields
  channel SenderChannel @default(email)
}
```

**Migration**: Backfill existing records:
- `emailBisonSenderId != null` AND (`linkedinProfileUrl != null` OR `loginMethod != 'none'`) → `both`
- `emailBisonSenderId != null` AND no LinkedIn fields → `email`
- `emailBisonSenderId == null` AND (`linkedinProfileUrl != null` OR `loginMethod != 'none'`) → `linkedin`

### 2. Replace all `emailBisonSenderId: null` filters

| File | Line | Current | Replace with |
|------|------|---------|-------------|
| `src/app/(admin)/workspace/[slug]/linkedin/page.tsx` | 33 | `emailBisonSenderId: null, OR: [linkedinProfileUrl, loginMethod]` | `channel: { in: ["linkedin", "both"] }` |
| `src/app/(portal)/portal/linkedin/page.tsx` | 33 | Already hotfixed (removed EB filter) | `channel: { in: ["linkedin", "both"] }` |
| `src/app/(portal)/portal/sender-health/page.tsx` | 185 | `emailBisonSenderId: null` | `channel: { in: ["linkedin", "both"] }` |
| `src/app/(admin)/workspaces/page.tsx` | 64-65 | `emailBisonSenderId != null` / `== null` | `channel` field for counting |
| `src/app/api/senders/route.ts` | 26 | Already hotfixed (removed EB filter) | `channel: { in: ["linkedin", "both"] }` |
| `src/lib/domain-health/bounce-monitor.ts` | 137, 284, 305 | `emailBisonSenderId === null` guard | `sender.channel !== "email"` guard |

### 3. Fix sync-senders merge logic

In `src/lib/emailbison/sync-senders.ts`, the name-match fallback (Priority 2) must check: if the matched sender has `channel: "linkedin"`, do NOT merge — create a new email-only record instead. Only merge if the existing record is `channel: "email"` or `channel: "both"`.

### 4. Set `channel` on creation

- `sync-senders` creates email records → set `channel: "email"`
- LinkedIn sender creation (wherever that happens — admin UI, API) → set `channel: "linkedin"`
- If a LinkedIn sender later gets an EmailBison ID (manual merge) → update to `channel: "both"`

### 5. Update dashboard stats queries

In `src/app/api/dashboard/stats/route.ts` (lines 206, 238, 481), replace `linkedinProfileUrl: { not: null }` filters with `channel: { in: ["linkedin", "both"] }`.

## Files to touch

- `prisma/schema.prisma` — add enum + field
- `prisma/migrations/` — new migration with backfill
- `src/app/(admin)/workspace/[slug]/linkedin/page.tsx`
- `src/app/(admin)/workspaces/page.tsx`
- `src/app/(portal)/portal/linkedin/page.tsx` (replace hotfix with proper channel filter)
- `src/app/(portal)/portal/sender-health/page.tsx`
- `src/app/api/senders/route.ts` (replace hotfix with proper channel filter)
- `src/app/api/dashboard/stats/route.ts`
- `src/app/api/portal/linkedin/status/route.ts`
- `src/lib/domain-health/bounce-monitor.ts`
- `src/lib/emailbison/sync-senders.ts`

## Out of scope

- Splitting into two separate tables (email + LinkedIn) — too disruptive, the single table with a discriminator is fine
- Refactoring the LinkedIn worker queries — the worker already uses `sessionStatus` correctly
- Changing the EmailBison API client — it doesn't touch LinkedIn

## Testing

- Verify Lucy Marshall appears on Lime portal LinkedIn page
- Verify Daniel Lazarus appears on 1210 admin LinkedIn page
- Verify workspaces overview counts both email and LinkedIn correctly for dual-purpose senders
- Run `sync-senders` and confirm it does NOT merge a LinkedIn-only sender with a same-name email inbox
- Verify bounce monitor skips LinkedIn-only senders without errors
- Verify dashboard stats include dual-purpose senders in LinkedIn metrics

## Priority

High — this is a data model bug that silently hides LinkedIn senders from the UI. Hotfixes are in place but fragile.
