# Code Cleanup Sweep — Code Agent Brief

## Objective
Clean up stale references, dead code, logging noise, and minor inconsistencies before deploying and onboarding new clients.

## Tasks

### 1. Remove Clay References
Clay was cancelled 2026-03-18. Clean up all remaining references:

- **`src/app/api/people/enrich/route.ts`** — Change `source: "clay"` to `source: "webhook"` on Person create (~line 204). Update comment "Map snake_case / alternate field names from Clay" to "Map snake_case / alternate field names from ingest payload".
- **`src/app/api/companies/enrich/route.ts`** — Same comment cleanup (~line 41, 80). Update "[Clay Enrich]" log prefix to "[Enrich]".
- **Both enrich endpoints** — Rename `CLAY_WEBHOOK_SECRET` env var references to `INGEST_WEBHOOK_SECRET`. Update log messages accordingly. (Note: also rename the actual env var on Vercel — flag this as a manual step, do NOT change Vercel env vars from code.)
- **`src/lib/clay/sync.ts`** — Delete this file entirely. `importClayContacts()` and `importClayCompany()` have no callers.
- **`src/app/api/exclusions/route.ts`** — Update `CLAY_WEBHOOK_SECRET` reference to `INGEST_WEBHOOK_SECRET`.
- **`src/proxy.ts`** — Update comments that say "Clay webhook" to "Ingest webhook".
- **`src/app/api/platform-costs/route.ts`** — Remove or update the Clay entry ($266.31/month, "Cancelling soon"). Clay is cancelled — either delete the seed entry or set cost to $0 with note "Cancelled 2026-03-18".
- **`src/lib/export/csv.ts`** — Update comments referencing Clay data format.
- **`src/lib/clients/task-templates.ts`** — Remove "Pull audience into a Clay table" subtask text from all 3 task templates (~lines 176, 426, 690). Replace with appropriate alternative (e.g. "Build audience list via discovery agents").
- **`src/lib/proposal-templates.ts`** — Update proposal copy that mentions Clay (~lines 68, 77, 88). Replace with current enrichment stack description (AI Ark, Prospeo, LeadMagic, FindyMail).
- **`src/lib/enrichment/types.ts`** — Keep `"clay"` in the Provider union type (needed for historical log records). Add a comment: `// historical — Clay cancelled 2026-03-18`.

### 2. Remove FindyMail Debug Logging
- **`src/lib/enrichment/providers/findymail.ts`** (~line 91) — Remove `console.log("[findymailAdapter] rawResponse:", ...)`. This logs every raw API response to console in production.

### 3. Fix API Response Format Inconsistency
- **`src/app/api/workspace/[slug]/members/route.ts`** — Ensure consistent response shape:
  - GET returns `{ members: Member[] }` ✓ (keep as is)
  - POST should return `{ member: Member }` → change to `{ members: Member[] }` (return full refreshed list, matching GET)
  - PATCH should return `{ member: Member }` → change to `{ members: Member[] }` (same)
  - DELETE should return consistent shape too → `{ members: Member[] }`
- Update `src/components/workspace/members-table.tsx` if it depends on the old `{ member }` shape from POST/PATCH/DELETE responses.

### 4. Add Enrichment Provider Env Var Validation
- **`src/lib/env.ts`** — Add `AIARK_API_KEY`, `PROSPEO_API_KEY`, `LEADMAGIC_API_KEY`, `FINDYMAIL_API_KEY`, `EMAILGUARD_API_TOKEN` to the optional vars list. This gives visibility at startup if keys are missing.

### 5. Verify AI Ark Auth Header
- **`src/lib/enrichment/providers/aiark-person.ts`** and **`src/lib/enrichment/providers/aiark.ts`** — Both have `LOW CONFIDENCE` warnings on the auth header (`X-TOKEN`). If AI Ark calls are working in production, remove the warning comments. If untested, add a TODO comment instead.

### 6. Clean Up Demo Campaigns
Check for any other demo/test campaigns across all workspaces that should be removed:
```
SELECT id, name, status, "workspaceSlug" FROM "Campaign"
WHERE name ILIKE '%demo%' OR name ILIKE '%test%' OR status = 'draft';
```
Report findings but do NOT delete without confirming — just list them.

### 7. Env Var Rename Plan
Output a clear list of env var renames needed on Vercel (manual step):
- `CLAY_WEBHOOK_SECRET` → `INGEST_WEBHOOK_SECRET`

Include instructions:
```
# On Vercel (use printf to avoid trailing newlines):
# 1. Copy current value of CLAY_WEBHOOK_SECRET
# 2. printf '%s' '<value>' | vercel env add INGEST_WEBHOOK_SECRET production
# 3. After deploy is verified, remove CLAY_WEBHOOK_SECRET
```

## Do NOT
- Delete `clientEmails`/`notificationEmails` from Prisma schema (rollback safety for Members migration)
- Change any enrichment adapter logic (just cleanup comments/logging)
- Delete env vars from Vercel (manual step — just document)
- Delete campaigns without user confirmation

## Key Files to Modify
- `src/app/api/people/enrich/route.ts`
- `src/app/api/companies/enrich/route.ts`
- `src/app/api/exclusions/route.ts`
- `src/app/api/platform-costs/route.ts`
- `src/app/api/workspace/[slug]/members/route.ts`
- `src/proxy.ts`
- `src/lib/enrichment/providers/findymail.ts`
- `src/lib/enrichment/providers/aiark-person.ts`
- `src/lib/enrichment/providers/aiark.ts`
- `src/lib/enrichment/types.ts`
- `src/lib/export/csv.ts`
- `src/lib/clients/task-templates.ts`
- `src/lib/proposal-templates.ts`
- `src/lib/env.ts`
- `src/components/workspace/members-table.tsx`

## Key Files to Delete
- `src/lib/clay/sync.ts`

## Success Criteria
- Zero Clay references in code except historical type union + env var rename docs
- No debug logging hitting production console
- Consistent API response shapes across members endpoints
- All enrichment provider env vars listed in env.ts
- Clean demo campaign audit
