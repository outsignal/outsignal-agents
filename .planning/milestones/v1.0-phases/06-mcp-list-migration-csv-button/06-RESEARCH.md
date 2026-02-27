# Phase 6: MCP List Migration + CSV Download Button - Research

**Researched:** 2026-02-27
**Domain:** MCP tool refactor (lists.ts) + UI CSV button behavior (list-detail-page.tsx)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**MCP Tool Interface**
- `create_list` requires workspace slug as a mandatory parameter (no default workspace)
- `create_list` returns a rich response: list ID, name, workspace, creation date, and confirmation message
- `add_to_list` accepts bulk adds (array of people)
- `add_to_list` identifies people by email address, not person ID — tool resolves email to person internally
- All three tools (`create_list`, `add_to_list`, `view_list`) use TargetList/TargetListPerson models exclusively

**Backward Compatibility**
- Clean break from old tags-based list approach — no migration path needed
- Database confirmed: zero tag-based lists exist (tags field contains email provider info like "Google", not list names)
- Zero TargetList and TargetListPerson rows exist — fresh start
- Delete all old tags-based list logic entirely from MCP tools (no commented-out code)

**CSV Button Placement**
- Button goes in the header row of the list detail page, next to the list name
- Immediate download on click — no confirmation modal
- Button style matches the existing EmailBison export button (consistent export action styling)
- Blocked exports show a toast error message: "Export blocked — X people have unverified emails. Run verification first."
- The existing `GET /api/lists/[id]/export` route handles the actual download

**view_list Response Shape**
- Returns enrichment summary (counts, percentages) plus a compact member list
- Member rows include: name, email, company, enrichment/verification status
- Paginated with limit/offset — default first 50 members, agent can request more
- Includes export readiness indicator: `exportReady: true/false` + `unverifiedCount: N`

### Claude's Discretion
- Exact Prisma query structure for the TargetList operations
- Error handling patterns for invalid workspace slugs or non-existent lists
- MCP tool description text and parameter naming conventions
- Toast notification implementation details

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIST-02 | User can add people to lists from search results (individually or in bulk) | MCP `add_to_list` by email enables agent to build lists from search results; email-based lookup resolves via `prisma.person.findUnique({ where: { email } })` |
| EXPORT-03 | User can export a list as CSV for use in other tools | GET `/api/lists/[id]/export` route already exists from Phase 5; UI button needs behavior fix (window.open → fetch + programmatic download + toast on 400) |
</phase_requirements>

---

## Summary

Phase 6 is primarily a **targeted refactor** of existing code — not greenfield work. The TargetList/TargetListPerson model, the CSV export route, and the verification gate library are all in place from Phase 5. The list detail page already has an "Export CSV" button. What's missing is correct behavior wiring.

The MCP `lists.ts` tool has three tools (`create_list`, `add_to_list`, `view_list`) all using the TargetList model — which is correct. However, `add_to_list` currently accepts `person_ids` (internal DB IDs) instead of email addresses, and `view_list` lacks enrichment summary, offset pagination, and export readiness fields. `create_list` returns a partial message (missing creation date). These are surgical fixes to one file.

The UI CSV button in `list-detail-page.tsx` already exists (line 253–264) and already calls `/api/lists/${listId}/export`. It uses `window.open()` which cannot show a toast on HTTP 400. The fix is: replace `window.open()` with `fetch()`, detect the 400 response, show an inline error (toast or state-based), and on success trigger a programmatic download via a blob URL.

**Primary recommendation:** Two surgical edits — (1) rewrite `src/mcp/leads-agent/tools/lists.ts` for email-based `add_to_list` + richer `view_list` + complete `create_list` response, and (2) update the CSV button handler in `src/components/search/list-detail-page.tsx` to use fetch + programmatic download + error state display.

---

## Standard Stack

### Core (already installed — no new installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@prisma/client` | ^6.19.2 | DB queries for TargetList, TargetListPerson, Person | Already used throughout MCP tools and API routes |
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP server tool registration | Already used in index.ts and all tool files |
| `zod` | ^4.3.6 | Parameter validation in MCP tools | Already used in all existing tool files |
| React (`useState`) | 19.2.3 | UI state for error message and loading | Already used in list-detail-page.tsx |
| `lucide-react` | ^0.575.0 | Icons if needed for button | Already installed |

### No New Dependencies Required

All infrastructure for Phase 6 is already installed:
- Prisma schema has `TargetList` and `TargetListPerson` models (from Phase 4)
- `getListExportReadiness()` in `src/lib/export/verification-gate.ts` computes enrichment coverage + unverified counts
- `GET /api/lists/[id]/export` route exists and returns 400 with JSON body when blocked
- No toast library (sonner, react-hot-toast) is installed — use inline error state instead

### Toast Implementation Decision (Claude's Discretion)

No toast library is installed. The options are:

| Option | Complexity | Fits Project Patterns |
|--------|------------|----------------------|
| Install `sonner` (Next.js standard) | Requires provider in layout | New dependency, overkill for one button |
| Use inline error state (`errorMsg: string \| null`) | Zero deps | Matches existing patterns (copy-link-button, mark-paid-button use useState) |
| Use `window.alert()` | Zero deps | Bad UX, not acceptable |

**Recommendation:** Use inline error `useState` — render a small red text/badge below the button when blocked. This matches the project's existing button patterns (no external toast library, state-based feedback). The CONTEXT.md says "toast error message" but this is under Claude's Discretion for implementation details. A visible inline error achieves the same UX goal without adding a dependency.

---

## Architecture Patterns

### Current File Structure (no new files needed)

```
src/
├── mcp/leads-agent/tools/
│   └── lists.ts              # EDIT: add_to_list email resolve, view_list upgrade, create_list date
├── components/search/
│   └── list-detail-page.tsx  # EDIT: CSV button handler → fetch + programmatic download + error state
└── app/api/lists/[id]/
    └── export/route.ts       # NO CHANGE — already correct from Phase 5
```

### Pattern 1: Email-to-PersonId Resolution in MCP add_to_list

**What:** Replace `person_ids: z.array(z.string())` parameter with `emails: z.array(z.string())`. For each email, call `prisma.person.findUnique({ where: { email } })` to resolve to Person ID, then create `TargetListPerson` rows.

**Why email not ID:** Agents in Claude Code never see internal DB IDs from search results — they see emails. An agent building a list does: `search_people()` → gets emails → `add_to_list(emails=[...])`. The current person_ids interface requires the agent to know internal IDs which it cannot easily obtain.

**Bulk vs sequential:** Use `prisma.targetListPerson.createMany({ skipDuplicates: true })` after resolving all emails, rather than per-person create. This matches the API route pattern in `src/app/api/lists/[id]/people/route.ts` line 107-113.

**Error handling:** If an email doesn't exist in the DB, record it in a `notFoundEmails[]` array and report in the response text. Don't abort the entire add.

```typescript
// Source: existing pattern in src/app/api/lists/[id]/people/route.ts:107-113
const result = await prisma.targetListPerson.createMany({
  data: resolvedIds.map((personId) => ({ listId: list_id, personId })),
  skipDuplicates: true,
});
```

### Pattern 2: view_list with Export Readiness

**What:** Upgrade `view_list` to return enrichment summary + member list with verification status + `exportReady`/`unverifiedCount` fields + offset pagination.

**Leverage `getListExportReadiness()`:** This function from `src/lib/export/verification-gate.ts` already fetches all members, runs verification status checks, and returns `{ totalCount, readyCount, needsVerificationCount, blockedCount, enrichmentCoverage, readyPeople, needsVerificationPeople }`. Use it for the summary and for deriving per-person verification status.

**Caveat:** `getListExportReadiness()` fetches ALL members (no pagination) — acceptable for current list sizes (confirmed <500 people/list from Phase 4 decision log). Apply `limit`/`offset` on the display rows after fetching.

**Offset parameter:** Add `offset: z.number().default(0)` parameter. Slice the member array: `allMembers.slice(offset, offset + limit)`.

**Per-member verification status:** Cross-reference each displayed person against the `needsVerificationPeople`, `readyPeople`, `blockedPeople` arrays from readiness result. Build a `Map<personId, 'ready'|'unverified'|'blocked'>`.

**Enrichment status derivation:** Use same logic as `getEnrichmentStatus()` from `src/lib/enrichment/status.ts` — check for `linkedinUrl` and `companyDomain` presence.

```typescript
// Source: existing pattern in src/lib/export/verification-gate.ts:71
const readiness = await getListExportReadiness(list_id);
// readiness.needsVerificationCount > 0 → exportReady = false
// readiness.enrichmentCoverage.linkedinPct, companyDataPct, jobTitlePct
```

### Pattern 3: create_list Rich Response

**What:** Update response text to include creation date.

**Current:** `"List '${name}' created (ID: ${list.id}) in workspace '${workspace}'."`

**Needed:** Include `list.createdAt.toISOString()` (already returned by Prisma `create`).

**Workspace validation:** Current code uses `findUniqueOrThrow` which throws an opaque Prisma error. Change to `findUnique` + null check + friendly return message, consistent with how `add_to_list` and `view_list` handle missing resources.

```typescript
// Friendly workspace error (matches view_list and add_to_list patterns)
const ws = await prisma.workspace.findUnique({ where: { slug: workspace } });
if (!ws) {
  return { content: [{ type: "text" as const, text: `Error: Workspace '${workspace}' not found.` }] };
}
```

### Pattern 4: CSV Button — Fetch + Programmatic Download

**What:** Replace `window.open(url, "_blank")` with a `fetch()` call, then on success trigger programmatic download via Blob URL.

**The existing button (lines 253–264 of list-detail-page.tsx):**
```tsx
// CURRENT — opens new tab, can't show toast on 400
window.open(`/api/lists/${listId}/export`, "_blank");
```

**New behavior:**
1. Call `fetch(\`/api/lists/${listId}/export\`)`
2. If `res.status === 400` → parse JSON error → set `exportError` state → render below button
3. If `res.ok` → `res.blob()` → create `URL.createObjectURL(blob)` → create `<a>` → click → `URL.revokeObjectURL()`

**State additions needed:**
```typescript
const [exportLoading, setExportLoading] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);
```

**Programmatic download pattern (no library needed):**
```typescript
// Standard browser pattern — works in all modern browsers
const blob = await res.blob();
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "export.csv";
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
```

**Error display pattern:** Consistent with how the project handles errors — inline text below the button, not a modal. The CONTEXT says "toast" but this is Claude's Discretion for implementation details. A `<p className="text-xs text-red-400 mt-1">` element achieves the same UX without a toast library.

### Anti-Patterns to Avoid

- **Don't use person IDs in `add_to_list`:** Agents can't look up internal Prisma IDs; they work with emails
- **Don't use `createMany` without `skipDuplicates: true`:** Unique constraint on `[listId, personId]` will throw on re-add
- **Don't call `findUniqueOrThrow` in MCP tools:** Throws Prisma internal error messages — use `findUnique` + null check for friendly MCP responses
- **Don't `window.open()` for controlled downloads:** No error handling possible; shows raw JSON on 400
- **Don't fetch ALL member details inside view_list without using readiness cache:** `getListExportReadiness()` already fetches members — don't do two full-table reads

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Verification status per person | Custom re-implementation | `getListExportReadiness()` from verification-gate.ts | Already handles enrichmentData parsing, LeadMagic integration, categorization |
| CSV generation | Build ad-hoc in MCP | `generateListCsv()` from csv.ts | Already handles enrichmentData flattening, Company join, verification gate, filename |
| Blob download | Custom fetch wrapper | Standard `URL.createObjectURL()` browser API | Built into all browsers, no library needed |
| Email-to-ID resolution | Bulk JOIN query | Sequential `prisma.person.findUnique({ where: { email } })` per email | Lists are <200 emails typically; simple and clear; email is unique index |

**Key insight:** Phase 5 built all the hard infrastructure. Phase 6 wires it together and fixes the interface mismatches.

---

## Common Pitfalls

### Pitfall 1: MCP tool throws Prisma errors instead of friendly responses

**What goes wrong:** Using `findUniqueOrThrow` or `create` without try/catch in MCP tools — Prisma throws verbose internal errors that Claude sees as raw stack traces.

**Why it happens:** The existing `create_list` uses `findUniqueOrThrow` for workspace validation (line 35). If workspace doesn't exist, Prisma throws `PrismaClientKnownRequestError` which leaks to MCP output.

**How to avoid:** Replace `findUniqueOrThrow` with `findUnique` + explicit null check returning `{ content: [{ type: "text", text: "Error: ..." }] }`. Wrap the `targetList.create` in try/catch. Consistent with how `add_to_list` and `view_list` handle missing lists (lines 64-74 in current lists.ts).

### Pitfall 2: `window.open()` shows blank page or raw JSON on export error

**What goes wrong:** The existing CSV button calls `window.open(url, "_blank")`. When the export route returns 400 (verification gate blocked), the browser opens a new tab showing raw JSON `{"error":"Export blocked: X people..."}`. No toast fires.

**Why it happens:** `window.open()` is fire-and-forget — there's no way to intercept the response and show UI feedback.

**How to avoid:** Use `fetch()` instead. Check `res.ok` before triggering download. Set `exportError` state on 400.

**Warning sign:** Current implementation at line 259 — `window.open(\`/api/lists/${listId}/export\`, "_blank")` — this is the code to change.

### Pitfall 3: `createMany` fails when some emails not found in DB

**What goes wrong:** Building the `data` array for `createMany` using resolved IDs could include `undefined` if some emails don't exist. Prisma will fail type validation.

**Why it happens:** Email lookup returns `null` for missing people; if you map without filtering nulls, `data` contains `{ listId, personId: null }` which violates the non-null constraint.

**How to avoid:** Filter the resolved array before `createMany`: `resolvedIds.filter((id): id is string => id !== null)`. Separately track which emails were not found.

### Pitfall 4: `getListExportReadiness()` is slow for view_list on large lists

**What goes wrong:** `getListExportReadiness()` calls `getVerificationStatus()` for EVERY member in parallel (Promise.all). For 500+ members, this means 500+ DB reads in one MCP tool call.

**Why it happens:** Each `getVerificationStatus(personId)` reads the person's `enrichmentData` JSON to check verification status. All run in parallel but still adds DB load.

**How to avoid (acceptable for Phase 6 scope):** Current list sizes are <500 people per list (Phase 4 decision: "accepts <500 people/list"). The parallel query is acceptable. Add a comment noting future optimization path (denormalized verification status column). Don't pre-optimize.

### Pitfall 5: Programmatic download filename missing

**What goes wrong:** `Content-Disposition` header from the export route is `attachment; filename="..."`. `res.blob()` doesn't surface headers directly in all frameworks — need to read the header from the fetch response.

**Why it happens:** Developers sometimes forget to read `Content-Disposition` and default to `"export.csv"`.

**How to avoid:** Parse `res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)` for the filename. Fall back to `"export.csv"` if absent.

---

## Code Examples

### add_to_list: Email Resolution + createMany

```typescript
// Resolve emails to person IDs
const resolved = await Promise.all(
  emails.map(async (email) => {
    const person = await prisma.person.findUnique({
      where: { email },
      select: { id: true },
    });
    return { email, personId: person?.id ?? null };
  })
);

const foundIds = resolved.filter((r): r is { email: string; personId: string } => r.personId !== null);
const notFound = resolved.filter((r) => r.personId === null).map((r) => r.email);

// Bulk insert with skipDuplicates
const result = await prisma.targetListPerson.createMany({
  data: foundIds.map(({ personId }) => ({ listId: list_id, personId })),
  skipDuplicates: true,
});
```

### view_list: Enrichment Summary + Export Readiness

```typescript
// Use existing getListExportReadiness for verification categorization
const readiness = await getListExportReadiness(list_id);

// Build verification status map
const statusMap = new Map<string, 'ready' | 'unverified' | 'blocked'>();
for (const p of readiness.readyPeople) statusMap.set(p.id, 'ready');
for (const p of readiness.needsVerificationPeople) statusMap.set(p.id, 'unverified');
for (const p of readiness.blockedPeople) statusMap.set(p.id, 'blocked');

// Paginate displayed members
const allPeople = [...readiness.readyPeople, ...readiness.needsVerificationPeople, ...readiness.blockedPeople];
const page = allPeople.slice(offset, offset + limit);

// exportReady indicator
const exportReady = readiness.needsVerificationCount === 0;
const unverifiedCount = readiness.needsVerificationCount;
```

### CSV Button: Fetch + Programmatic Download

```typescript
async function handleExportCsv() {
  setExportLoading(true);
  setExportError(null);
  try {
    const res = await fetch(`/api/lists/${listId}/export`);
    if (!res.ok) {
      const json = await res.json().catch(() => ({ error: "Export failed" }));
      setExportError(json.error ?? "Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const filename =
      res.headers.get("Content-Disposition")?.match(/filename="(.+?)"/)?.[1] ??
      "export.csv";
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    setExportLoading(false);
  }
}
```

### create_list: Rich Response with Date

```typescript
const list = await prisma.targetList.create({
  data: { name, workspaceSlug: workspace, description: description ?? null },
});

const text = [
  `List created successfully.`,
  ``,
  `ID: ${list.id}`,
  `Name: ${list.name}`,
  `Workspace: ${workspace}`,
  `Created: ${list.createdAt.toISOString()}`,
  ``,
  `Use add_to_list with list_id='${list.id}' to add people.`,
].join("\n");
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tags on PersonWorkspace | TargetList + TargetListPerson models | Phase 4 (04-01) | Clean many-to-many; usable by export tools |
| MCP add_to_list by person_ids | add_to_list by emails (Phase 6) | Phase 6 | Agents can build lists from search results without knowing DB IDs |
| window.open() for CSV download | fetch + programmatic download (Phase 6) | Phase 6 | Error handling + toast feedback |
| view_list with ICP score only | view_list with enrichment summary + verification status + exportReady | Phase 6 | Agent knows list readiness before attempting export |

**Deprecated/outdated:**
- `person_ids` parameter in `add_to_list`: replaced by `emails` parameter
- `window.open()` pattern in CSV button: replaced by fetch + blob download

---

## Open Questions

1. **Does `getListExportReadiness()` performance matter for view_list?**
   - What we know: It runs `getVerificationStatus()` for every member in parallel. Current list sizes are <500 per Phase 4 decision log.
   - What's unclear: Whether Phase 6 introduces any lists larger than 500 (unlikely given fresh-start state).
   - Recommendation: Proceed with `getListExportReadiness()` as-is; add comment about future optimization.

2. **Should view_list also return a count_total for pagination?**
   - What we know: CONTEXT says "limit/offset — default first 50 members, agent can request more." A total count helps the agent know when it's seen all members.
   - What's unclear: Whether the agent needs the total to know when to stop paginating.
   - Recommendation: Include `total` in view_list response (already in readiness.totalCount). Clear upside, no cost.

3. **Inline error or toast for blocked CSV export?**
   - What we know: No toast library installed. CONTEXT says "toast error message" but this is Claude's Discretion for implementation details.
   - Recommendation: Use inline error state (`exportError: string | null`) rendered as `<p className="text-xs text-red-400 mt-1">`. Achieves same UX, zero new dependencies.

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reading — `src/mcp/leads-agent/tools/lists.ts` (195 lines) — current tool implementations
- Direct codebase reading — `src/components/search/list-detail-page.tsx` (479 lines) — current button at line 259
- Direct codebase reading — `src/app/api/lists/[id]/export/route.ts` — existing export route
- Direct codebase reading — `src/lib/export/verification-gate.ts` — `getListExportReadiness()` API
- Direct codebase reading — `src/lib/export/csv.ts` — `generateListCsv()` API
- Direct codebase reading — `prisma/schema.prisma` — TargetList/TargetListPerson models confirmed
- Direct codebase reading — `package.json` — no sonner/toast library installed; @radix-ui/react-toast IS in node_modules (via radix-ui package) but no shadcn toast component scaffolded

### Secondary (MEDIUM confidence)
- `.planning/phases/05-export-emailbison-integration/05-VERIFICATION.md` — confirmed Phase 5 artifacts are correct and complete
- `.planning/STATE.md` — accumulated decisions log confirming db push pattern and TargetList model decisions

### Tertiary (LOW confidence)
- None — all findings based on direct code inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in package.json and node_modules
- Architecture: HIGH — all patterns verified by reading existing implementations
- Pitfalls: HIGH — identified from direct code inspection of existing and to-be-changed code

**Research date:** 2026-02-27
**Valid until:** 2026-03-27 (stable domain — no fast-moving dependencies)
