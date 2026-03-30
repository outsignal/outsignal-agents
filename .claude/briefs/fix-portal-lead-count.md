# Fix: Portal campaigns list showing 0 Total Leads for LinkedIn campaigns

## Problem
The client portal campaigns list (`/portal/campaigns`) shows "Total Leads: 0" for LinkedIn-only campaigns, even though the campaigns have target lists with hundreds of leads (e.g. 900, 54, 144).

## Root Cause
In `src/app/(portal)/portal/campaigns/page.tsx` (line ~67), the merge logic pulls `totalLeads` from EmailBison:
```typescript
totalLeads: ebMatch?.total_leads ?? 0,
```
LinkedIn campaigns have no EmailBison match (EB only tracks email campaigns), so it falls back to 0.

## Fix Required

### File 1: `src/lib/campaigns/operations.ts`
In the `listCampaigns()` function (~line 305), update the Prisma query to include the TargetList people count. Add to the `include` block:
```typescript
targetList: {
  select: {
    _count: {
      select: { people: true }
    }
  }
}
```
And include the count in the returned `CampaignSummary` object — add a `targetListLeadCount` field.

### File 2: `src/app/(portal)/portal/campaigns/page.tsx`
In the merge logic (~line 67), change:
```typescript
totalLeads: ebMatch?.total_leads ?? 0,
```
to:
```typescript
totalLeads: ebMatch?.total_leads ?? c.targetListLeadCount ?? 0,
```
This way:
- Email campaigns: get count from EmailBison (accurate for email tracking)
- LinkedIn campaigns: get count from internal TargetList
- No match at all: falls back to 0

### Also check
- The admin dashboard campaigns page (`src/app/(admin)/campaigns/page.tsx`) may have the same issue — check if it also pulls lead counts from EB only.
- The `CampaignSummary` type will need updating to include the new `targetListLeadCount` field.

## Testing
1. Open the client portal as Lime Recruitment
2. Filter to LinkedIn campaigns
3. Verify C1 shows 900, C2 shows 54, C3 shows 144 in Total Leads column
