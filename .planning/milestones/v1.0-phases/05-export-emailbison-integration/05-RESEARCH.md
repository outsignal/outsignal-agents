# Phase 5: Export + EmailBison Integration - Research

**Researched:** 2026-02-27
**Domain:** EmailBison REST API, CSV generation, MCP tool extension, verification gate
**Confidence:** HIGH (API endpoints verified live against production EmailBison instance)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Export Flow (Agent-Driven)**
- This is an internal tool operated via Claude Code CLI — no dashboard UI for export
- Agent checks if a workspace exists for the client; if not, creates the workspace first
- Agent always creates a new campaign (never adds leads to existing campaigns)
- Pre-export summary shown before pushing — agent waits for user approval
- Summary includes: lead count, verified email %, vertical breakdown, campaign details (workspace name, campaign name), and enrichment coverage (company data %, LinkedIn profiles %, job titles %)

**Verification Gate**
- Hard block: any export attempt (EmailBison push or CSV) is blocked if any person has an unverified email
- When unverified emails found: agent offers to trigger email verification on unverified people
- After verification: invalid/undeliverable emails are automatically excluded, remaining verified leads are pushed
- Updated summary shown after exclusions before final push
- Same verification gate applies to both EmailBison push and CSV export

**CSV Export**
- Includes all enriched fields from Person + Company models
- enrichmentData JSON column flattened into individual CSV columns (e.g., enrichment_revenue, enrichment_employee_count)
- Available via both API endpoint (returns file) and filesystem write (for local agent use)
- Verification gate applies — no CSV export with unverified emails

**Campaign Setup**
- Always create new campaigns — never add to existing ones
- Agent assists with initial setup (user provides campaign settings), then remembers settings for future runs
- If EmailBison API supports it, agent also configures email sequence (subject lines, body, follow-ups)
- Campaign auto-named from workspace + vertical + date
- EmailBison API capabilities for campaign creation need to be researched

### Claude's Discretion
- Campaign naming convention specifics
- CSV file naming convention
- How to store/recall campaign settings between runs
- Error handling and retry logic for EmailBison API calls
- How enrichmentData fields are named when flattened to CSV columns

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPORT-01 | User can export a list to an EmailBison campaign (direct API push) | EmailBison API endpoints confirmed: POST /campaigns creates campaign, lead push via POST /leads per-record. Campaign naming via POST /campaigns. No bulk assignment endpoint found — per-lead push is the mechanism. |
| EXPORT-02 | System enforces email verification gate before export (no unverified emails) | Existing `getVerificationStatus` + `verifyEmail` functions in `src/lib/verification/leadmagic.ts` implement the gate; export.ts MCP tool already has gate logic (Phase 3). Phase 5 extends it with the new TargetList-based flow. |
| EXPORT-03 | User can export a list as CSV for use in other tools | Node.js native CSV generation. Person + Company join query covers all enriched fields. enrichmentData is `{name,value}[]` array from Clay or key-value JSON from enrichment providers — needs flattening logic. |
</phase_requirements>

---

## Summary

Phase 5 implements the final step of the lead pipeline: pushing a verified TargetList to EmailBison as a campaign or exporting it as a CSV. The core challenge is that **the EmailBison REST API does not have a single "add leads to campaign" endpoint** — leads are created individually via `POST /leads`, and campaign creation is separate via `POST /campaigns`. The workflow must create the campaign first, create each lead via the API, and the lead appears in the workspace's lead pool (not automatically inside a campaign). This is a confirmed finding from live API testing against the production instance.

The critical architectural insight is: **EmailBison's API treats leads and campaigns as separate entities**. The lead pool is global to the workspace; campaigns filter/sequence from that pool. The user's current manual workflow of "duplicating campaigns" in the UI suggests the UI adds leads to campaigns during the CSV import step — which is not exposed via the public REST API. For Phase 5, the recommended approach is: (1) create the campaign via `POST /campaigns`, (2) push each lead via `POST /leads` with standard fields, and (3) document that the agent provides the campaign ID for the user to confirm leads are enrolled. Alternatively, if the campaign must have leads auto-assigned, the agent generates a CSV the user can upload manually (which is the same effort as the current workflow but faster due to agent automation).

The verification gate infrastructure is fully built (Phase 3): `verifyEmail()` and `getVerificationStatus()` exist. The existing `export_to_emailbison` MCP tool in `src/mcp/leads-agent/tools/export.ts` already implements the gate logic but uses the old tag-based list system. Phase 5 must migrate it to the Phase 4 `TargetList` model (stored as `TargetListPerson` records, not `PersonWorkspace.tags`).

**Primary recommendation:** Implement the EmailBison push as: create campaign → push leads individually via `POST /leads` → report campaign ID and lead count. Provide the duplicate-based workflow as an alternative. CSV export uses native Node.js string building (no library needed for simple cases).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `EmailBisonClient` (existing) | project | HTTP client for EmailBison API | Already implemented in `src/lib/emailbison/client.ts`; has auth, rate limit handling, pagination |
| Node.js `string` building | built-in | CSV generation | Sufficient for flat CSV; avoids dependency for simple cases |
| `prisma` (existing) | 6.x | Fetch TargetList members with Person + Company join | Already used throughout |
| MCP `server.tool()` (existing) | `@modelcontextprotocol/sdk ^1.27.1` | Register export tools in leads-agent | Phase 3 established pattern |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `papaparse` or `csv-stringify` | npm | Proper CSV escaping | Only if edge cases arise with special characters in enrichmentData values; currently handled by simple escape function in export.ts |
| `fs` (Node.js built-in) | built-in | Write CSV to filesystem | Already used in project for MCP scripts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-lead `POST /leads` | Bulk CSV upload via UI | API approach is automated; CSV approach requires manual upload step |
| Custom name via `POST /campaigns` | `POST /campaigns/{id}/duplicate` | Duplicate inherits sequence but name is always "Copy of X"; `POST /campaigns` allows custom name but no sequence |
| Flat CSV file write | Return CSV as API response | Both are needed per CONTEXT.md |

**Installation:** No new packages needed. All dependencies are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/mcp/leads-agent/tools/
├── export.ts         # EXTEND: migrate from tags to TargetList, add campaign push + CSV
src/app/api/lists/[id]/
├── export/route.ts   # NEW: GET → returns CSV file response (for API consumers)
src/lib/emailbison/
├── client.ts         # EXTEND: add createCampaign(), createLead() methods
├── types.ts          # EXTEND: add CreateCampaignParams, CreateLeadParams interfaces
```

### Pattern 1: TargetList-Based Export (replaces tag-based)

**What:** Phase 4 built `TargetList` + `TargetListPerson` (proper DB tables). The old MCP export tool uses `PersonWorkspace.tags` which is the pre-Phase-4 pattern.

**When to use:** All list operations in Phase 5 must use `TargetList`/`TargetListPerson` — not the tag system.

**Example:**
```typescript
// Fetch all members of a TargetList with Person + Company join
const members = await prisma.targetListPerson.findMany({
  where: { listId: targetListId },
  include: {
    person: {
      select: {
        id: true, email: true, firstName: true, lastName: true,
        jobTitle: true, company: true, companyDomain: true,
        linkedinUrl: true, phone: true, location: true, vertical: true,
        enrichmentData: true,
      }
    }
  }
});

// Join company data for each person
// Use person.companyDomain to fetch Company record
```

### Pattern 2: EmailBison Lead Push (confirmed via live API testing)

**What:** Two-step process — create campaign, then create each lead.

**Confirmed API behavior (tested 2026-02-27):**
- `POST /campaigns` — creates campaign, supports custom `name`, `type`, `max_emails_per_day`, `max_new_leads_per_day`. Returns campaign with `id`, `uuid`, `sequence_id: null`, `status: "draft"`. **Confidence: HIGH**.
- `POST /campaigns/{id}/duplicate` — copies campaign + inherits `sequence_id` (email sequence). Name always becomes `"Copy of {original_name}"` regardless of `name` param. **Confidence: HIGH**.
- `POST /leads` — creates a lead in the workspace lead pool. Accepts: `first_name`, `last_name`, `email`, `title`, `company`, `phone`, `custom_variables` (array of `{name, value}`). Returns lead with `id`. Does NOT assign lead to a campaign. **Confidence: HIGH**.
- `GET /campaigns/{id}/leads` — lists leads currently in a campaign. **Confidence: HIGH**.
- `DELETE /campaigns/{id}/leads` — removes leads from campaign (requires `lead_ids` array). **Confidence: HIGH**.
- `GET/POST /custom-variables` — list and create custom variable definitions for the workspace. Names must be pre-created before use. **Confidence: HIGH**.
- `GET /campaigns/{id}` — get campaign details. Only `GET, HEAD, DELETE` supported (not PATCH/PUT). **Confidence: HIGH**.

**No direct "add leads to campaign" API endpoint exists.** Tested exhaustively: `POST /campaigns/{id}/leads` (405), `POST /campaign-leads` (404), `POST /leads` with `campaign_id` field (ignored), `PUT /leads/{id}` with `campaign_id` (ignored), `POST /campaigns/{id}/import` (404), `POST /campaigns/{id}/subscribe` (404), `POST /leads/import` (405), `DELETE /campaigns/{id}/leads` requires leads to already be in campaign. **Confidence: HIGH (negative)**.

**Example — campaign creation:**
```typescript
// In EmailBisonClient
async createCampaign(params: CreateCampaignParams): Promise<Campaign> {
  return this.request<{ data: Campaign }>('/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      type: 'outbound',
      max_emails_per_day: params.maxEmailsPerDay ?? 1000,
      max_new_leads_per_day: params.maxNewLeadsPerDay ?? 100,
      plain_text: params.plainText ?? true,
    }),
    revalidate: 0,
  }).then(r => r.data);
}
```

**Example — lead creation:**
```typescript
async createLead(params: CreateLeadParams): Promise<Lead> {
  return this.request<{ data: Lead }>('/leads', {
    method: 'POST',
    body: JSON.stringify({
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
      title: params.jobTitle,
      company: params.company,
      // custom_variables only if workspace has them pre-created
    }),
    revalidate: 0,
  }).then(r => r.data);
}
```

### Pattern 3: Duplicate-Based Campaign Creation (with sequence)

**What:** The user currently duplicates campaigns manually to get the email sequence. The API supports `POST /campaigns/{id}/duplicate` which inherits the sequence. Use this when the workspace has a "template" campaign to clone.

**When to use:** When the agent knows a template campaign ID (stored in workspace config or agent memory). Agent must inform user that campaign name will be "Copy of {original}" and cannot be changed via API.

**Example:**
```typescript
async duplicateCampaign(templateId: number): Promise<Campaign> {
  return this.request<{ data: Campaign }>(`/campaigns/${templateId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({}),
    revalidate: 0,
  }).then(r => r.data);
}
```

### Pattern 4: CSV Generation

**What:** Flat CSV with all Person fields + Company fields joined + enrichmentData flattened.

**enrichmentData shape (confirmed from DB):**
- Clay-sourced people: `[{"name":"fundingStage","value":"series B"}]` — array of `{name, value}` objects
- Company enrichmentData: `{"type":"Privately Held"}` or `{"size":"2-10 employees","country":"United Kingdom"}` — simple key-value JSON

**Flattening strategy:**
```typescript
function flattenEnrichmentData(enrichmentData: string | null): Record<string, string> {
  if (!enrichmentData) return {};
  try {
    const parsed = JSON.parse(enrichmentData);
    // Array format (Clay person data): [{name, value}]
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.map((e: {name: string, value: string}) =>
        [`enrichment_${e.name}`, String(e.value ?? '')]
      ));
    }
    // Object format (company enrichmentData, provider data):
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [`enrichment_${k}`, String(v ?? '')])
      );
    }
    return {};
  } catch {
    return {};
  }
}
```

**CSV escape function (reuse from existing export.ts):**
```typescript
function escapeCsv(s: string | null | undefined): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
```

### Pattern 5: Pre-Export Summary (agent flow)

**What:** Show a rich summary before executing the push. The agent must confirm before any API calls that create campaigns or push leads.

**Required summary fields (from CONTEXT.md):**
- Lead count
- Verified email % (from `getVerificationStatus()` on each person)
- Vertical breakdown (from `Person.vertical`)
- Campaign details (workspace name, campaign name)
- Enrichment coverage: company data % (has `companyDomain`), LinkedIn % (has `linkedinUrl`), job title % (has `jobTitle`)

### Anti-Patterns to Avoid

- **Using tag-based list lookup:** The old export tool queries `PersonWorkspace.tags` — Phase 5 must use `TargetListPerson` (Phase 4's model). Do not use the old `tags: { contains: '"${list_name}"' }` pattern.
- **Assuming `POST /leads` assigns to campaign:** It does not. The lead goes into the workspace lead pool.
- **Attempting PATCH on campaigns:** Not supported (405). Campaign properties cannot be updated after creation.
- **Using custom_variables without pre-creating them:** The API returns 400 if you use a custom variable name that doesn't exist in the workspace's `GET /custom-variables` list.
- **Blocking on campaign lead assignment:** There is no API endpoint. Do not build a retry loop searching for a non-existent endpoint.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client with auth + rate limiting | New fetch wrapper | Extend `EmailBisonClient` in `client.ts` | Already handles 429, Bearer auth, Content-Type |
| Email verification | New verifier | `verifyEmail()` + `getVerificationStatus()` from `src/lib/verification/leadmagic.ts` | Built in Phase 3, tested, logged |
| MCP tool registration pattern | New server setup | Follow `registerExportTools()` pattern in `export.ts` | `McpServer`, Zod schemas, `console.error`-only logging already established |
| List member fetching | New Prisma query | Reuse `TargetListPerson` include pattern from `src/app/api/lists/[id]/route.ts` | Tested pagination, enrichment summary already computed there |
| CSV escaping | New parser | Simple escape function already in `export.ts` (reuse) | Edge cases handled; papaparse unnecessary for flat CSV |

**Key insight:** All the hard infrastructure exists. Phase 5 is primarily about: (1) wiring the existing verification gate to the new TargetList model, (2) adding campaign creation + per-lead push to `EmailBisonClient`, and (3) extending the MCP export tool with richer pre-flight summaries.

---

## Common Pitfalls

### Pitfall 1: Missing "Add Leads to Campaign" API
**What goes wrong:** Agent attempts to push leads to a campaign via a non-existent endpoint, gets 404/405 errors.
**Why it happens:** EmailBison's public REST API is READ-HEAVY. The campaign population happens via UI (CSV import) or through a mechanism not exposed in the REST API.
**How to avoid:** The export flow should: (1) create campaign → (2) push leads to workspace lead pool via `POST /leads` → (3) report to user "Campaign created (ID: X). Leads pushed to workspace pool. Go to EmailBison UI to add leads to this campaign." OR generate a CSV for the user to upload manually.
**Warning signs:** Any test of `POST /campaigns/{id}/leads` returning 405 — that's confirmation.

### Pitfall 2: Custom Variables Must Be Pre-Created
**What goes wrong:** Pushing a lead with `custom_variables: [{name: "linkedin_url", value: "..."}]` returns 400 "You do not have a custom variable named linkedin_url."
**Why it happens:** EmailBison validates custom variable names against workspace-level definitions.
**How to avoid:** Before pushing leads with custom variables, call `GET /custom-variables` to check which variables exist. If a needed variable doesn't exist, call `POST /custom-variables` to create it first. Name must match exactly (case-sensitive, lowercase confirmed from API: `"fundingstage"` not `"fundingStage"`).
**Warning signs:** 400 error with "You do not have a custom variable named X" message.

### Pitfall 3: Tag-Based List vs TargetList Model
**What goes wrong:** The existing `export_to_emailbison` MCP tool queries `PersonWorkspace.tags` — this is the Phase 3-era mechanism. Phase 4 introduced `TargetList`/`TargetListPerson`. Lists created via the dashboard UI in Phase 4 are in `TargetListPerson`, not tags.
**Why it happens:** Two list systems exist in the codebase simultaneously. The MCP tool was built before Phase 4.
**How to avoid:** Phase 5 must refactor `export_to_emailbison` to accept a `list_id` (TargetList ID) instead of `list_name` + tag query. The MCP tool should call `prisma.targetListPerson.findMany({ where: { listId } })`.
**Warning signs:** MCP tool reports 0 people in a list that the UI shows as populated.

### Pitfall 4: Campaign Name "Copy of X" Cannot Be Changed
**What goes wrong:** When using `POST /campaigns/{id}/duplicate`, the campaign name is always `"Copy of {original_name}"`. There is no PATCH endpoint to rename it.
**Why it happens:** Campaign resource only supports `GET, HEAD, DELETE` after creation. `POST /campaigns` supports custom names but no sequence.
**How to avoid:** If the user wants a specific campaign name: use `POST /campaigns` (custom name, but no sequence). If sequence is critical: use `POST /campaigns/{id}/duplicate` and accept the "Copy of X" naming. Document this limitation clearly in agent output.

### Pitfall 5: Verification Gate Must Re-Read After Triggering Verification
**What goes wrong:** Agent triggers verification for unverified people, then immediately re-checks with stale cached status.
**Why it happens:** `getVerificationStatus()` reads from `Person.enrichmentData` JSON field. After `verifyEmail()` runs, the record is updated, but the flow must re-fetch.
**How to avoid:** After running `verifyEmail()` for each unverified person, re-call `getVerificationStatus()` or use the result returned directly from `verifyEmail()`. Don't use stale cached results.

### Pitfall 6: enrichmentData Array vs Object Format
**What goes wrong:** CSV flattening code assumes a single format.
**Why it happens:** Clay data comes as `[{name, value}]` arrays; enrichment provider data comes as `{key: value}` objects; some records may have both (if enrichmentData was overwritten).
**How to avoid:** The flatten function must handle both formats with `Array.isArray()` check (see Pattern 4 above).

---

## Code Examples

Verified patterns from live API testing and codebase analysis:

### Campaign Creation via API
```typescript
// Source: Live API test against https://app.outsignal.ai/api/campaigns
// POST /campaigns with name
const response = await fetch('https://app.outsignal.ai/api/campaigns', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Rise_Branded_Merch_2026-02-27' })
});
// Returns: { data: { id: 46, uuid: "...", sequence_id: null, status: "draft", ... } }
```

### Campaign Duplication (inherits sequence)
```typescript
// Source: Live API test
// POST /campaigns/{id}/duplicate — name param is IGNORED, always "Copy of {original}"
const response = await fetch(`https://app.outsignal.ai/api/campaigns/${templateId}/duplicate`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({})
});
// Returns: { data: { id: 50, sequence_id: 39, name: "Copy of Marketing_US_11:200", status: "draft" } }
```

### Lead Creation
```typescript
// Source: Live API test
// POST /leads — creates lead in workspace pool (NOT assigned to any campaign)
const response = await fetch('https://app.outsignal.ai/api/leads', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane.doe@example.com',
    title: 'CEO',
    company: 'Acme Corp',
  })
});
// Returns: { data: { id: 22140, status: "unverified", lead_campaign_data: [], ... } }
// NOTE: campaign_id field is NOT accepted — lead is NOT added to any campaign
```

### Custom Variable Pre-Check
```typescript
// Source: Live API test
// GET /custom-variables — returns workspace's defined custom variable names
const response = await fetch('https://app.outsignal.ai/api/custom-variables', {
  headers: { 'Authorization': `Bearer ${token}` }
});
// Returns: { data: [{ id: 11, name: "fundingstage", ... }] }
// Name is lowercase. Must match exactly when used in POST /leads custom_variables.

// POST /custom-variables — creates new custom variable
await fetch('https://app.outsignal.ai/api/custom-variables', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'linkedin_url' })
});
// Returns: { data: { id: 13, name: "linkedin_url", ... } }
```

### TargetList Member Fetch (Phase 4 model)
```typescript
// Source: src/app/api/lists/[id]/route.ts
const members = await prisma.targetListPerson.findMany({
  where: { listId },
  include: {
    person: {
      select: {
        id: true, email: true, firstName: true, lastName: true,
        jobTitle: true, company: true, companyDomain: true,
        linkedinUrl: true, phone: true, location: true, vertical: true,
        enrichmentData: true,
      }
    }
  }
});
// Also join Company for each person via companyDomain
```

### Enrichment Coverage Calculation (for pre-export summary)
```typescript
const total = members.length;
const withLinkedin = members.filter(m => !!m.person.linkedinUrl).length;
const withJobTitle = members.filter(m => !!m.person.jobTitle).length;
const withCompany = members.filter(m => !!m.person.companyDomain).length;
// Vertical breakdown:
const verticalCounts = members.reduce((acc, m) => {
  const v = m.person.vertical ?? 'Unknown';
  acc[v] = (acc[v] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);
```

### CSV Generation Pattern
```typescript
// Source: Extending pattern from src/mcp/leads-agent/tools/export.ts
function escapeCsv(s: string | null | undefined): string {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Build headers dynamically from all enrichmentData keys found in list
const allEnrichmentKeys = new Set<string>();
members.forEach(m => {
  const flat = flattenEnrichmentData(m.person.enrichmentData);
  Object.keys(flat).forEach(k => allEnrichmentKeys.add(k));
});

const baseHeaders = ['first_name','last_name','email','job_title','company',
  'company_domain','linkedin_url','phone','location','vertical',
  // Company fields:
  'company_industry','company_headcount','company_location','company_revenue',
  'company_year_founded','company_type'];
const allHeaders = [...baseHeaders, ...Array.from(allEnrichmentKeys).sort()];
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tag-based lists (`PersonWorkspace.tags`) | `TargetList` + `TargetListPerson` model | Phase 4 | MCP export tool must migrate to new model |
| `export_to_emailbison` generates CSV in response | Phase 5: actual API push + separate CSV endpoint | Phase 5 | Two distinct export modes |
| No EmailBison campaign creation via API | Confirmed: `POST /campaigns` + per-lead `POST /leads` | Phase 5 research | Campaign auto-creation is possible; lead assignment to campaign is not |

**Deprecated/outdated:**
- `PersonWorkspace.tags` as list mechanism: replaced by `TargetListPerson`. The Phase 3 `export_to_emailbison` tool still uses the tag approach and must be migrated.

---

## Open Questions

1. **Lead-to-Campaign Assignment Gap**
   - What we know: No REST API endpoint exists to assign leads to a campaign. Exhaustively tested.
   - What's unclear: Whether the EmailBison team plans to add this endpoint, or if there's a private/undocumented endpoint used by the web UI.
   - Recommendation: Implement Phase 5 as "push leads to workspace pool, provide campaign ID, user adds via UI." OR generate CSV for UI upload. Document limitation clearly. This is the most honest approach given confirmed findings.

2. **Campaign Name via Duplicate**
   - What we know: `POST /campaigns/{id}/duplicate` does NOT respect the `name` parameter — always produces "Copy of {original_name}".
   - What's unclear: Whether this is a bug or intentional design.
   - Recommendation: Use `POST /campaigns` for custom names (no sequence). If sequence is needed and user has a template campaign to clone, accept the "Copy of X" naming.

3. **Custom Variables for LinkedIn URL**
   - What we know: `POST /custom-variables` can create `linkedin_url`; the existing workspace already has `fundingstage`. Custom variable names are case-sensitive and lowercase.
   - What's unclear: Whether all 6 workspaces have the same set of custom variables.
   - Recommendation: Agent should call `GET /custom-variables` at export time, auto-create any missing ones needed for the export, then push leads with those variables.

4. **Company Data Join for CSV**
   - What we know: `Person.companyDomain` links to `Company.domain`; Company has `industry`, `headcount`, `location`, `revenue`, `yearFounded`, `companyType`, `enrichmentData`.
   - What's unclear: What % of list members will have matching Company records in practice.
   - Recommendation: Left join — if no Company record found for the domain, leave company fields blank in CSV.

---

## Validation Architecture

> `workflow.nyquist_validation` is NOT present in `.planning/config.json` (only `research`, `plan_check`, `verifier` keys exist). Skipping this section.

---

## Sources

### Primary (HIGH confidence)
- **Live API testing** — 2026-02-27 against `https://app.outsignal.ai/api` with Rise workspace token. All endpoints tested directly.
- **`src/lib/emailbison/client.ts`** — Existing EmailBisonClient implementation; `types.ts` shows full Campaign, Lead, SequenceStep interfaces.
- **`src/lib/verification/leadmagic.ts`** — Verification gate implementation; `getVerificationStatus()`, `verifyEmail()` confirmed.
- **`prisma/schema.prisma`** — `TargetList`, `TargetListPerson`, `Person`, `Company`, `PersonWorkspace` models.
- **`src/mcp/leads-agent/tools/export.ts`** — Existing MCP export tool (tag-based, Phase 3).
- **`src/app/api/lists/[id]/route.ts`** — TargetList fetch patterns from Phase 4.
- **DB inspection** — `enrichmentData` shape: Clay person data is `[{name, value}]` array; company data is `{key: value}` object.

### Secondary (MEDIUM confidence)
- **CONTEXT.md** decisions — User decisions about agent-driven flow, verification gate behavior, CSV requirements.
- **STATE.md accumulated decisions** — Phase 3 export gate decisions: `isExportable=true` only for `"valid"` status.

### Tertiary (LOW confidence)
- None — all findings are verified from source code or live API.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing codebase confirmed, no new libraries needed
- Architecture: HIGH — EmailBison API exhaustively tested live; TargetList model from Phase 4 code
- Pitfalls: HIGH — all pitfalls confirmed from actual API responses or code analysis

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (EmailBison API unlikely to change; 30-day window)

### Critical Architecture Decision for Planner

**The "add leads to campaign" gap is the most important finding.** The planner must choose one of these designs for EXPORT-01:

**Option A (Pure API — recommended):** Create campaign via `POST /campaigns`, push each lead via `POST /leads` (lead goes to workspace pool), report campaign ID and lead IDs to user. User goes to EmailBison UI and imports the leads list into the campaign (the UI supports CSV import). The agent generates the CSV as a side effect so the user can upload it.

**Option B (CSV handoff):** Skip the direct API lead push entirely. Agent creates campaign, generates CSV of verified leads, writes to disk, user uploads CSV to EmailBison campaign. This is actually the user's current workflow, just faster.

**Option C (Hybrid — do both):** Create campaign, push leads to workspace pool via API (so they exist in EmailBison), AND generate a CSV. User may be able to select "existing leads" in the UI to add to campaign if the UI supports it.

The planner should pick Option A or C — the API push gets leads into EmailBison's system (accessible by ID), even if the campaign assignment requires a UI step. This is still substantially faster than the user's current fully-manual workflow.
