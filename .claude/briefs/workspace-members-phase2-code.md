# Workspace Members Phase 2 — Code Agent Brief

## Objective
Replace the JSON array-based member system (`clientEmails`/`notificationEmails` on Workspace) with a proper `Member` model, role-based access, and an invite-on-add flow.

## Current State
- Members stored as JSON string arrays on `Workspace.clientEmails` and `Workspace.notificationEmails`
- Auth: magic link tokens (`MagicLinkToken` model) → HMAC-signed cookies
- Portal auth: `src/lib/portal-auth.ts` / `src/lib/require-portal-auth.ts`
- Admin auth: `src/lib/admin-auth.ts` / `src/lib/require-admin-auth.ts`
- API routes: `src/app/api/workspace/[slug]/members/route.ts` (GET/POST/DELETE/PATCH)
- UI component: `src/components/workspace/members-table.tsx`
- Members page: `src/app/(admin)/workspace/[slug]/members/page.tsx`

## Tasks

### 1. New Prisma Model
Add to `prisma/schema.prisma`:

```prisma
model Member {
  id                   String    @id @default(cuid())
  email                String
  name                 String?
  role                 String    @default("viewer") // "owner" | "admin" | "viewer"
  workspaceSlug        String
  workspace            Workspace @relation(fields: [workspaceSlug], references: [slug])
  notificationsEnabled Boolean   @default(true)
  status               String    @default("invited") // "invited" | "active" | "disabled"
  invitedAt            DateTime  @default(now())
  invitedBy            String?   // email of who invited them
  lastLoginAt          DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  @@unique([email, workspaceSlug])
  @@index([workspaceSlug])
  @@index([email])
}
```

Add `members Member[]` relation to the `Workspace` model.

### 2. Data Migration Script
Create `scripts/migrate-members.ts`:
- Read all workspaces with `clientEmails` and `notificationEmails`
- Parse JSON arrays
- For each email, create a `Member` record:
  - `role`: "owner" if email matches workspace creator (default to "viewer" if unknown)
  - `notificationsEnabled`: true if email is in `notificationEmails`
  - `status`: check `MagicLinkToken` records — if any `used: true` token exists → "active", if unused tokens exist → "invited", otherwise → "invited"
  - `lastLoginAt`: most recent `used: true` MagicLinkToken `createdAt`
- Log migration summary (count per workspace)
- DO NOT remove `clientEmails`/`notificationEmails` fields yet (keep for rollback safety)

### 3. Update API Routes
Rewrite `src/app/api/workspace/[slug]/members/route.ts`:

**GET** — Query `Member` model instead of parsing JSON arrays. Return `{ members: Member[] }`.

**POST (Add Member)** — Accept `{ email: string, name?: string, role?: string }`:
- Create `Member` record with status "invited"
- Generate `MagicLinkToken` immediately
- Send magic link email (reuse existing logic from `src/app/api/portal/login/route.ts`)
- Return created member

**PATCH (Update Member)** — Accept `{ email: string, role?: string, notificationsEnabled?: boolean }`:
- Update the Member record
- Return updated member

**DELETE (Remove Member)** — Accept `{ email: string }`:
- Soft-disable: set `status: "disabled"` (don't hard delete)
- Return success

**New: POST /api/workspace/[slug]/members/resend-invite** — Accept `{ email: string }`:
- Validate member exists and status is "invited"
- Generate new `MagicLinkToken`, send magic link email
- Return success

### 4. Update Portal Auth Flow
In `src/app/api/portal/verify/route.ts`:
- After verifying token, update `Member.lastLoginAt` and set `status: "active"`
- Include `member.role` in the portal session cookie payload

In `src/lib/portal-auth.ts`:
- Add `role` to `PortalSession` type

### 5. Update Notification System
In `src/lib/notifications.ts`:
- Replace `workspace.notificationEmails` JSON parsing with `Member` query:
  ```ts
  const members = await prisma.member.findMany({
    where: { workspaceSlug: slug, notificationsEnabled: true, status: { not: "disabled" } }
  })
  ```
- Use `members.map(m => m.email)` for notification recipients

### 6. Role-Based Access (Portal)
Add helper `src/lib/member-permissions.ts`:
```ts
export function canManageCampaigns(role: string): boolean { return role === "owner" || role === "admin" }
export function canManageSenders(role: string): boolean { return role === "owner" || role === "admin" }
export function canManageMembers(role: string): boolean { return role === "owner" }
export function canViewReports(role: string): boolean { return true }
```

Apply in portal API routes and pages where relevant. Viewer = read-only access to portal pages.

### 7. Update Members Table Component
Update `src/components/workspace/members-table.tsx` to work with the new API shape:
- Add `name` column
- Add `role` column (render as badge for now — design agent will upgrade to dropdown)
- Add "Resend Invite" button for members with status "invited"
- Keep existing notification toggle, delete, and status badge logic
- Ensure the component works with the new `Member` object shape

### 8. Cleanup
- Add `member` to the Cmd+K search (if applicable)
- Update any other files that reference `workspace.clientEmails` or `workspace.notificationEmails` — grep the codebase

## Do NOT
- Remove `clientEmails`/`notificationEmails` from schema (keep for rollback)
- Change admin auth (only portal auth gets role awareness)
- Touch the portal login page UI (design agent scope)
- Add any new dependencies

## Key Files to Modify
- `prisma/schema.prisma`
- `src/app/api/workspace/[slug]/members/route.ts`
- `src/app/api/portal/verify/route.ts`
- `src/lib/portal-auth.ts`
- `src/lib/notifications.ts`
- `src/components/workspace/members-table.tsx`
- `src/app/(admin)/workspace/[slug]/members/page.tsx`

## Key Files to Create
- `scripts/migrate-members.ts`
- `src/lib/member-permissions.ts`
- `src/app/api/workspace/[slug]/members/resend-invite/route.ts`

## Run After
- `npx prisma db push`
- `npx ts-node scripts/migrate-members.ts` (or `npx tsx`)
- Verify on `/workspace/outsignal/members` that existing members appear correctly
