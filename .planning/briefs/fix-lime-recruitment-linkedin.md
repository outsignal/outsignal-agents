# Brief: Fix Lime Recruitment LinkedIn (Lucy Marshall)

## Problem
Lucy Marshall's LinkedIn session has been expired since 2026-03-28. Most likely cause: `lime-recruitment` was never added to the `WORKSPACE_SLUGS` env var on Railway, so the worker never ran keepalives for her.

Additionally, there are 56 duplicate "Lucy Marshall" sender records (all `not_setup`) created by a bulk creation bug in session 38. Only 1 record (`cmn33vcla0001p8881epefuxe`) ever had an active session.

## Tasks

### 1. Verify WORKSPACE_SLUGS on Railway
- Run `railway login` (requires browser auth)
- Run `railway variables | grep WORKSPACE_SLUGS`
- Confirm whether `lime-recruitment` is in the list
- If missing, add it: `railway variables set WORKSPACE_SLUGS="<existing>,lime-recruitment"`

### 2. Clean up duplicate sender records
- Delete the 56 duplicate Lucy Marshall records that have `sessionStatus: "not_setup"` and `linkedinProfileUrl: null`
- Keep only `cmn33vcla0001p8881epefuxe` (the one with session history)
- Query to identify: `prisma.sender.findMany({ where: { workspaceSlug: 'lime-recruitment', name: 'Lucy Marshall', sessionStatus: 'not_setup' } })`
- Delete: `prisma.sender.deleteMany({ where: { id: { in: [...duplicateIds] } } })`

### 3. Reconnect Lucy's session
- This requires manual cookie extraction from LinkedIn
- Admin navigates to LinkedIn in browser, extracts `li_at` + `JSESSIONID` cookies
- POST to `/api/linkedin/senders/cmn33vcla0001p8881epefuxe/reconnect` with the new cookies
- OR use the admin dashboard reconnect flow

### 4. Verify keepalive fires
- After WORKSPACE_SLUGS is updated (or dynamic discovery is deployed), monitor Railway logs
- Confirm `[Keepalive]` log entries appear for Lucy Marshall's sender
- Confirm `lastKeepaliveAt` updates within 4-6 hours

## Dependencies
- Task 1 requires Railway CLI login (manual step)
- Task 3 requires manual LinkedIn cookie extraction (manual step)
- If the dynamic workspace discovery brief is implemented first, task 1 becomes unnecessary

## Sender Record
- ID: `cmn33vcla0001p8881epefuxe`
- Workspace: `lime-recruitment`
- Session status: `expired`
- Health status: `session_expired`
- Last keepalive: 2026-03-27T14:10:18.881Z
- Session connected: 2026-03-27T14:10:18.881Z (identical — suspicious)
