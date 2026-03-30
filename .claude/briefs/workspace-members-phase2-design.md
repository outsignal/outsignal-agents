# Workspace Members Phase 2 — Design Agent Brief

## Objective
Polish the workspace members page UI to support the new Member model with roles, invite flow, and better status tracking. Run AFTER the code agent brief is complete.

## Context
- **Brand color**: `#635BFF` (purple)
- **Design system**: Tailwind CSS, Radix UI primitives, Geist fonts, warm stone neutrals
- **Existing component**: `src/components/workspace/members-table.tsx`
- **Page**: `src/app/(admin)/workspace/[slug]/members/page.tsx`
- **Member model fields**: `email`, `name`, `role` (owner/admin/viewer), `status` (invited/active/disabled), `notificationsEnabled`, `lastLoginAt`, `invitedAt`

## Tasks

### 1. Members Table Redesign
Update `src/components/workspace/members-table.tsx`:

**Columns** (left to right):
1. **Member** — Avatar circle (initials from name/email) + name + email stacked. If no name, show email only.
2. **Role** — Dropdown select (owner/admin/viewer). Owner role is non-editable. Use Radix Select or similar. PATCH `/api/workspace/[slug]/members` on change.
3. **Status** — Badge: green "Active", amber "Invited", gray "Disabled"
4. **Notifications** — Toggle switch (not checkbox)
5. **Last Login** — Relative time ("3d ago") or "Never"
6. **Actions** — Icon button menu: "Resend Invite" (only for invited), "Disable Member", "Remove Member"

**Design notes**:
- Table rows should have hover state (subtle background shift)
- Keep it clean — no borders between columns, just row dividers
- Empty state: illustration or icon + "No members yet. Add your first team member."

### 2. Add Member Dialog
Redesign the existing add member dialog:
- **Fields**: Email (required), Name (optional), Role dropdown (default: viewer)
- **Button**: "Send Invite" (not "Add Member" — because it sends a magic link immediately)
- **After success**: Show toast "Invite sent to {email}" and refresh table
- **Validation**: Email format, show inline error if invalid

### 3. Remove/Disable Confirmation
- "Disable Member" → sets status to disabled, can be re-enabled
- "Remove Member" → permanent deletion, requires typing email to confirm (destructive action pattern)
- Use Radix AlertDialog with red destructive button

### 4. Page Header
Update the members page header:
- Title: "Team Members"
- Subtitle: "{n} members · {n} active"
- "Add Member" button (right-aligned, primary style with `#635BFF`)

### 5. Role Badges
- **Owner**: Purple badge (`#635BFF` bg, white text)
- **Admin**: Blue badge
- **Viewer**: Gray badge (stone-200 bg, stone-600 text)

### 6. Mobile Responsive
- On mobile, collapse table to card layout
- Each card shows: avatar + name/email, role badge, status badge
- Actions available via "..." menu on each card

## Do NOT
- Change the API routes (code agent already built these)
- Add new dependencies without checking if Radix already provides the primitive
- Change the page route or file structure
- Touch portal-side UI (that's a separate brief)

## Reference
- Check existing components in `src/components/` for patterns already in use (badges, dialogs, tables)
- Follow the same patterns used in other workspace pages (senders, deliverability, etc.)
