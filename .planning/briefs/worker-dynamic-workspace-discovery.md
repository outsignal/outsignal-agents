# Brief: Worker Dynamic Workspace Discovery

## Problem
The LinkedIn worker reads workspace slugs from a hardcoded `WORKSPACE_SLUGS` env var on Railway. When a new client is onboarded, someone must manually update this env var and restart the worker. If forgotten, the worker silently ignores the workspace — no keepalives, no actions, no conversation polling. This is what caused Lucy Marshall's (Lime Recruitment) LinkedIn session to expire.

## Goal
The worker should dynamically discover active workspaces from the database instead of relying on a manually maintained env var.

## Current Architecture
- `worker/src/index.ts`: reads `WORKSPACE_SLUGS` env var, splits by comma, passes array to Worker constructor
- `worker/src/worker.ts`: iterates `this.options.workspaceSlugs` in every tick — keepalives, actions, conversation checks
- Worker authenticates to the Next.js API via `API_SECRET` header (`verifyWorkerAuth`)
- Existing endpoint `GET /api/workspaces` requires admin auth (not worker auth) — cannot be reused directly

## Implementation

### 1. New API endpoint: `GET /api/linkedin/workspaces`
- **File**: `src/app/api/linkedin/workspaces/route.ts` (new)
- **Auth**: `verifyWorkerAuth` (same as other `/api/linkedin/*` endpoints)
- **Query**: `prisma.workspace.findMany({ where: { status: 'active' }, select: { slug: true } })`
- **Response**: `{ slugs: ["rise", "lime-recruitment", ...] }`
- Keep it minimal — worker only needs slugs

### 2. Update `worker/src/index.ts`
- Remove the `WORKSPACE_SLUGS` env var requirement (no longer exits if missing)
- If `WORKSPACE_SLUGS` is set, use it as a fallback/override (backwards compatible)
- If not set, log that dynamic discovery will be used

### 3. Update `worker/src/worker.ts`
- At the start of each `tick()`, call `GET /api/linkedin/workspaces` to refresh the slug list
- Cache the result for 5 minutes (don't hit the API every 2-minute tick)
- Replace `this.options.workspaceSlugs` references with the dynamic list
- On API failure, fall back to the last known list (or the env var if set)

### 4. Add `ApiClient` method
- **File**: `worker/src/api-client.ts`
- Add `getWorkspaceSlugs(): Promise<string[]>` method
- Calls `GET /api/linkedin/workspaces`
- Returns array of slugs

## Constraints
- Do NOT remove `WORKSPACE_SLUGS` support entirely — keep as optional override for debugging/testing
- Cache TTL should be 5 minutes — new workspaces appear within 5 min, not instantly, which is fine
- Worker must not crash if the API call fails — fall back gracefully
- Minimal changes to worker.ts tick loop — just swap the slug source

## Testing
- Verify worker starts without `WORKSPACE_SLUGS` set
- Verify worker discovers all active workspaces
- Verify adding a new workspace via onboarding makes it appear within 5 minutes
- Verify worker still works with `WORKSPACE_SLUGS` as override

## Files to Change
1. `src/app/api/linkedin/workspaces/route.ts` (new)
2. `worker/src/api-client.ts` (add method)
3. `worker/src/index.ts` (make WORKSPACE_SLUGS optional)
4. `worker/src/worker.ts` (dynamic slug refresh in tick)
