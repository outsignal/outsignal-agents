# Phase 47: Client Memory Namespace - Research

**Researched:** 2026-03-23
**Domain:** Flat-file memory infrastructure, DB seeding script, gitignore patterns, cross-client intelligence namespace
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Memory file structure
- **4 files per workspace** (grouped, not granular):
  - `profile.md` — company name, vertical, ICP description, tone/voice, outreach channel prefs, package type, key contacts, website URL, **standing instructions** (admin-editable client-specific rules like "Rise prefers short sequences", "BlankTag is LinkedIn-only")
  - `campaigns.md` — campaign history with performance data (name, channel, status, reply rate, open rate, lead count) + copy wins/losses
  - `feedback.md` — client feedback, approval patterns, what they approved/rejected and why
  - `learnings.md` — ICP learnings, lead source effectiveness, vertical-specific insights accumulated over time
- Directory: `.nova/memory/{slug}/` (decided in Phase 46 context)
- All files gitignored, directory structure via `.gitkeep`

#### Seeding strategy
- **Rich seed** — pull maximum available data from DB:
  - ICP description, tone prompt, all campaigns (names + status + channel + reply rate + open rate + lead count)
  - Last 10 replies with classifications, approval history, workspace package
  - Website URL, key contacts
- **Re-run behavior**: seed script overwrites `profile.md` only (always fresh from DB). Leaves `campaigns.md`, `feedback.md`, `learnings.md` untouched (accumulated intelligence preserved)
- Campaigns.md seeded with **names + performance data** (not full copy sequences)

#### Write governance
- **Append with timestamp** — agents append new entries at the bottom with ISO timestamps. Never delete or overwrite existing entries
- **200-line limit per file** — matches Claude Code's own memory limit
- **Overflow handling**: when a file hits 200 lines, agent summarises the oldest 50 entries into 5-10 lines, deletes the originals. Preserves intelligence in compressed form
- **No validation** — trust agents to write sensible entries. Admin reviews periodically. No dedup or contradiction checking

#### Global insights
- **Content**: benchmarks (cross-client reply rates, open rates, best channels per vertical) + copy patterns (subject lines, structures, styles that work across clients) + operational insights (send times, lead source quality, ICP scoring patterns)
- **Single writer**: only `nova-intel` (intelligence agent) can write to `global-insights.md`. Other agents read only
- **Seeded from DB**: pull current cross-client averages as initial baseline (reply rates, open rates by vertical, lead source rankings)
- Location: `.nova/memory/global-insights.md`

### Claude's Discretion
- Exact markdown format/headers within each memory file
- How the seed script queries and formats DB data
- Whether to include email templates in campaigns.md seeding (decided: no, just names + performance)
- Exact summary format when compressing old entries

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEM-01 | Per-workspace memory directory structure exists for all 8 client workspaces (`.nova/memory/{slug}/`) | 10 workspaces in DB (8 active clients + situ + ladder-group); `.nova/` exists at project root; `memory/` subdirectory not yet created |
| MEM-02 | Memory schema defined with named sections (profile, campaigns, feedback, learnings) | CONTEXT.md locks 4-file schema; section headers and governance rules documented in this research |
| MEM-03 | All 8 workspace memory files seeded with initial content from existing DB fields | DB query confirms data availability per workspace; field mapping documented in Architecture Patterns section |
| MEM-04 | Memory files gitignored with directory structure preserved via `.gitkeep` | `.nova/memory/` not yet in `.gitignore`; pattern documented; `.gitkeep` placement specified |
| MEM-05 | Memory read at skill invocation start via shell injection — every session is client-aware from first turn | Phase 49 concern (skill files); this phase creates the files skills will read. Research notes injection pattern. |
| MEM-06 | Memory accumulation instructions wired into all specialist skills — agents write learnings after sessions | Phase 49 concern (skill files); this phase defines the write governance spec skills will follow |
| MEM-07 | Approval pattern tracking in per-client feedback memory (what copy/leads the client approved or rejected) | No existing feedback data in DB (0 campaigns with contentFeedback); feedback.md seeded with empty scaffold + governance header |
| MEM-08 | Cross-client global learning namespace (`global-insights.md`) for patterns that apply across all workspaces | CachedMetrics table has campaign_snapshot data with replyRate/openRate per campaign; seed pulls cross-workspace averages |
</phase_requirements>

---

## Summary

Phase 47 is pure infrastructure scaffolding — no agent skills, no UI, no new API endpoints. The deliverable is: (1) `.nova/memory/{slug}/` directories for all active workspaces, (2) four markdown files per workspace with seeded content from the DB, (3) a global `global-insights.md` with cross-client benchmarks, and (4) a CLI seed script (`nova-memory seed`) that regenerates `profile.md` on demand while leaving accumulated files untouched.

The DB audit reveals that workspace data richness is uneven. Five workspaces have both ICP criteria and core offers populated (myacq, lime-recruitment, blanktag, yoopknows, 1210-solutions), three have offers but no ICP criteria (rise, outsignal, covenco), and ladder-group has minimal data. Situ is a 10th workspace discovered in the DB (not listed in MEMORY.md's 8 clients). The seed script must gracefully handle sparse data — a workspace with no ICP criteria gets a placeholder row, not an empty file. The `CachedMetrics` table holds `campaign_snapshot` records with `replyRate`, `openRate`, `bounceRate` per campaign — this is the correct source for `campaigns.md` performance data and `global-insights.md` benchmarks.

The technical implementation is straightforward TypeScript using `@prisma/client` and Node `fs` APIs. No new npm packages are needed. The seed script is a `scripts/nova-memory.ts` CLI runnable via `npx tsx scripts/nova-memory.ts seed [slug]` — consistent with the existing `scripts/ingest-document.ts` pattern. The `.gitignore` needs a single new entry for `.nova/memory/**/*.md`. A `.gitkeep` file in `.nova/memory/` is required to keep the empty directory structure trackable.

**Primary recommendation:** Build the seed script first (it proves the DB query approach), run it against all workspaces, then add the gitignore entry and `.gitkeep` files — in that order.

---

## Standard Stack

### Core

| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `@prisma/client` | Project standard (Prisma 6) | Query workspace, campaign, reply, cachedMetrics data | Already installed; all agent code uses it |
| Node `fs/promises` | Built-in | Write `.md` files to `.nova/memory/` | No extra dependency needed for flat-file writes |
| `npx tsx` | Project standard | Run TypeScript CLI scripts | Consistent with `scripts/ingest-document.ts` pattern |

### Supporting

| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `process.argv` | Built-in | Parse `seed [slug]` / `seed --all` args | Keeps CLI parsing dependency-free |
| `path.join` | Built-in | Construct `.nova/memory/{slug}/` paths | Safer than string concatenation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npx tsx` for seed script | Compile to `dist/scripts/` | Compilation adds complexity; one-off seed script doesn't need fast startup |
| Flat `.md` files | SQLite or JSON | Flat files are admin-inspectable and Claude Code readable; DB adds operational overhead |

**Installation:** No new packages needed. All dependencies are already in `package.json`.

---

## Architecture Patterns

### Directory Structure (post-Phase 47)

```
.nova/
  ARCHITECTURE.md          # Exists (Phase 46)
  memory/
    .gitkeep               # Keeps directory in git, no content
    global-insights.md     # Cross-client benchmarks (gitignored content)
    rise/
      .gitkeep             # Keeps slug directory in git
      profile.md           # Gitignored — seeded fresh from DB
      campaigns.md         # Gitignored — seeded + accumulated
      feedback.md          # Gitignored — scaffold only (no DB data exists)
      learnings.md         # Gitignored — scaffold only initially
    lime-recruitment/
      ... (same 4 files)
    ... (all 10 workspace slugs)

scripts/
  nova-memory.ts           # Seed CLI: `npx tsx scripts/nova-memory.ts seed [slug|--all]`
```

### Pattern 1: Seed Script CLI Interface

**What:** Single TypeScript CLI script with two modes — `seed [slug]` for one workspace, `seed --all` for all workspaces.
**When to use:** New machine setup, new workspace onboarding, admin profile refresh.

```typescript
// scripts/nova-memory.ts
// Usage: npx tsx scripts/nova-memory.ts seed [slug]
//        npx tsx scripts/nova-memory.ts seed --all

const command = process.argv[2]; // "seed"
const target = process.argv[3];  // slug or "--all"

if (command === 'seed') {
  if (target === '--all') {
    const workspaces = await prisma.workspace.findMany({ select: { slug: true } });
    for (const ws of workspaces) {
      if (ws.slug) await seedWorkspace(ws.slug);
    }
  } else {
    await seedWorkspace(target);
  }
}
```

### Pattern 2: Selective Overwrite (profile.md only)

**What:** Re-seed overwrites `profile.md` (always DB-fresh), skips other files if they exist.
**When to use:** Every time seed is run — preserves accumulated intelligence.

```typescript
async function seedWorkspace(slug: string) {
  const dir = path.join(process.cwd(), '.nova', 'memory', slug);
  await fs.mkdir(dir, { recursive: true });

  // Always overwrite profile.md — always fresh from DB
  await fs.writeFile(path.join(dir, 'profile.md'), buildProfile(workspace));

  // Only write campaigns.md/feedback.md/learnings.md if they don't exist
  for (const file of ['campaigns.md', 'feedback.md', 'learnings.md']) {
    const filePath = path.join(dir, file);
    try {
      await fs.access(filePath); // throws if missing
      console.log(`  Skipping ${file} (exists — accumulated data preserved)`);
    } catch {
      await fs.writeFile(filePath, buildInitialContent(file, workspace, metrics));
    }
  }

  // Ensure .gitkeep exists for directory tracking
  await fs.writeFile(path.join(dir, '.gitkeep'), '');
}
```

### Pattern 3: Memory File Schema (Markdown with Governance Header)

**What:** Every file starts with a governance header comment that tells agents exactly how to write to it.

```markdown
<!-- profile.md | workspace: rise | seeded: 2026-03-23 | re-seed: overwrites this file -->
<!-- Write governance: NEVER append to this file — it is regenerated by `nova-memory seed` -->

# Rise — Workspace Profile

## Company
- **Name**: Rise
- **Vertical**: Branded Merchandise
- **Website**: [url]
- **Package**: Email (2 campaigns/mo, 2,000 leads/mo)

## ICP
[icpCriteriaPrompt content or "Not configured — admin should add via workspace settings"]

## Tone & Voice
[outreachTonePrompt or "Not configured — default professional tone applies"]

## Outreach Channels
Email only (LinkedIn module not enabled)

## Key Contacts
[senderFullName/senderJobTitle or "Not configured"]

## Standing Instructions
<!-- Admin-editable: add per-client rules here that agents must always follow -->
<!-- Example: "Never use hyphens in copy", "Always mention mental health donation angle" -->
(none — add standing instructions here)
```

```markdown
<!-- campaigns.md | workspace: rise | seeded: 2026-03-23 | re-seed: skips if exists -->
<!-- Write governance: APPEND only, with ISO timestamp. Max 200 lines. Never delete existing entries. -->

# Rise — Campaign History & Copy Intelligence

## Seeded Campaigns (from DB, 2026-03-23)

| Campaign | Channel | Status | Reply Rate | Open Rate | Leads |
|----------|---------|--------|------------|-----------|-------|
| People_USA_11:200 | email | active | 4.1% | 0% | 267 |
...

## Copy Wins
<!-- Agent: append entries here when copy performs well (reply rate >5%) -->
(none yet)

## Copy Losses
<!-- Agent: append entries here when copy is revised/rejected with reason -->
(none yet)
```

```markdown
<!-- feedback.md | workspace: rise | seeded: 2026-03-23 | re-seed: skips if exists -->
<!-- Write governance: APPEND only, with ISO timestamp. Never overwrite or delete. -->

# Rise — Client Feedback & Approval Patterns

## Approval History
<!-- Agent: append entries as: [ISO date] Campaign: [name] — [Approved|Rejected] — [reason if known] -->
(none yet)

## Client Preferences Observed
<!-- Agent: append observations about what this client tends to approve or push back on -->
(none yet)
```

```markdown
<!-- learnings.md | workspace: rise | seeded: 2026-03-23 | re-seed: skips if exists -->
<!-- Write governance: APPEND only, with ISO timestamp. Never overwrite or delete. -->

# Rise — ICP & Campaign Learnings

## ICP Learnings
<!-- Agent: append discoveries about which ICP segments respond best -->
(none yet)

## Lead Source Effectiveness
<!-- Agent: append notes on which discovery sources yield quality leads for this workspace -->
(none yet)

## Vertical-Specific Insights
<!-- Agent: append insights specific to Branded Merchandise vertical -->
(none yet)
```

### Pattern 4: Global Insights Seeding from CachedMetrics

**What:** Pull `campaign_snapshot` records from `CachedMetrics` table, compute cross-client averages, seed `global-insights.md`.

```typescript
// CachedMetrics.data is JSON string with: replyRate, openRate, bounceRate, channels[], status
const snapshots = await prisma.cachedMetrics.findMany({
  where: { metricType: 'campaign_snapshot' },
  select: { metricKey: true, data: true, computedAt: true }
});

const parsed = snapshots.map(s => {
  const d = JSON.parse(s.data as string);
  return {
    campaignName: d.campaignName,
    replyRate: d.replyRate,
    openRate: d.openRate,
    bounceRate: d.bounceRate,
    channels: d.channels,
    status: d.status
  };
}).filter(s => s.status === 'completed' || s.status === 'active');

// Compute cross-client averages for email campaigns
const emailCampaigns = parsed.filter(s => s.channels?.includes('email'));
const avgReplyRate = (emailCampaigns.reduce((sum, s) => sum + s.replyRate, 0) / emailCampaigns.length).toFixed(2);
```

### Anti-Patterns to Avoid

- **Writing profile.md via agents**: `profile.md` is DB-sourced only. Include the governance comment AND document in the global instructions that agents never write to profile.md.
- **Single `.gitkeep` at root only**: Each slug directory also needs a `.gitkeep` — otherwise empty slug directories disappear from git and new machines miss the scaffolding.
- **Omitting the governance header**: Without the `<!-- Write governance: -->` comment, agents cannot know append-only rules from reading the file alone.
- **Crashing on sparse data**: `ladder-group` has no website, no vertical, no ICP. Seed script must use empty-string fallbacks with explicit placeholder text, never `undefined`.
- **Seeding `feedback.md` from campaign approval fields**: `contentFeedback` and `leadsFeedback` are currently `null` on all 0 campaigns in DB. Do not query these — scaffold only.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memory rotation/compression | Custom file truncation logic | Inline agent instruction ("summarise oldest 50 entries") | Agents already follow instructions; no code needed for overflow handling — it's a behavioral rule in the skill file |
| Global insights computation | Custom analytics pipeline | Direct Prisma query on `CachedMetrics.campaign_snapshot` | The data is already pre-computed and cached; no need to re-aggregate from raw reply/email tables |
| Secret in seed output | Manual redaction | Prisma returns only the fields you select — never select `apiToken`, `DATABASE_URL` | Query only non-sensitive fields; no redaction needed if query is scoped correctly |

**Key insight:** The seed script is a simple DB query + file write. No custom middleware, no abstraction layers, no error recovery infrastructure needed. The governance rules live as markdown comments in the files themselves, not in code.

---

## Common Pitfalls

### Pitfall 1: Wrong Workspace Count (8 vs 10 in DB)
**What goes wrong:** Phase requirements say "all 8 client workspaces" but DB has 10 workspace slugs (including `situ` and `ladder-group`).
**Why it happens:** MEMORY.md lists 8 active managed clients; `situ` and `ladder-group` were added later or are in different states.
**How to avoid:** Run `nova-memory seed --all` against all 10 DB workspaces. The task description says "8 client workspaces" — seed all 10 to future-proof. The extra two files cost nothing.
**Warning signs:** Hardcoding the slug list in the seed script — always query DB for slugs.

### Pitfall 2: `.gitignore` Pattern Too Broad
**What goes wrong:** Adding `.nova/memory/` to `.gitignore` also ignores the `.gitkeep` files, breaking the directory scaffold.
**Why it happens:** `.gitignore` pattern `.nova/memory/**` ignores ALL content including `.gitkeep`.
**How to avoid:** Use the pattern `.nova/memory/**/*.md` to ignore only markdown files. Then explicitly NOT-ignore `.gitkeep` files:
```
.nova/memory/**/*.md
!.nova/memory/**/.gitkeep
```
Or use the simpler approach: add individual negation entries after the wildcard rule.

### Pitfall 3: CachedMetrics Data is JSON String
**What goes wrong:** `CachedMetrics.data` field is a Prisma `Json` type but stored as serialized JSON string — direct property access fails.
**Why it happens:** The schema stores arbitrary metric data as `Json`/string.
**How to avoid:** Always `JSON.parse(s.data as string)` before accessing `replyRate`, `openRate`, etc. Wrap in try/catch for malformed entries.

### Pitfall 4: Seeding Creates Duplicate campaigns.md on Re-Run
**What goes wrong:** Running `seed --all` twice produces duplicate campaign entries in `campaigns.md`.
**Why it happens:** If the skip-if-exists check is missing, re-seed overwrites `campaigns.md` but the new seeded content differs from accumulated content.
**How to avoid:** The `fs.access()` guard is critical — only write non-profile files when they DON'T exist yet. Profile.md always overwrites. All others skip if present.

### Pitfall 5: Empty `.nova/memory/` Directory Lost on Clone
**What goes wrong:** After `git clone`, `.nova/memory/` directory doesn't exist because it's gitignored, so `nova-memory seed` fails with ENOENT.
**Why it happens:** Gitignored directories are not tracked; only files inside them are.
**How to avoid:** Commit `.nova/memory/.gitkeep` (root level) AND `.nova/memory/{slug}/.gitkeep` for each workspace. The seed script also uses `fs.mkdir({ recursive: true })` to create directories before writing.

---

## Code Examples

### Complete DB Query for profile.md

```typescript
// Source: Prisma schema (verified against live DB 2026-03-23)
const workspace = await prisma.workspace.findUniqueOrThrow({
  where: { slug },
  select: {
    slug: true,
    name: true,
    vertical: true,
    website: true,
    icpCriteriaPrompt: true,
    icpCountries: true,
    icpIndustries: true,
    icpDecisionMakerTitles: true,
    icpCompanySize: true,
    coreOffers: true,
    painPoints: true,
    differentiators: true,
    normalizationPrompt: true,
    enabledModules: true,
    monthlyCampaignAllowance: true,
    monthlyLeadQuota: true,
    senderFullName: true,
    senderJobTitle: true,
    onboardingNotes: true,
    // DO NOT select: apiToken, clientEmails, billingRetainerPence (sensitive)
  }
});
```

### Complete DB Query for campaigns.md Seeding

```typescript
// Source: Prisma schema (verified against live DB 2026-03-23)
// Step 1: get campaign IDs for this workspace
const campaigns = await prisma.campaign.findMany({
  where: { workspaceSlug: slug },
  select: { id: true, name: true, channels: true, status: true, createdAt: true }
});

// Step 2: get performance snapshots from CachedMetrics
const campaignIds = campaigns.map(c => c.id);
const snapshots = await prisma.cachedMetrics.findMany({
  where: { metricType: 'campaign_snapshot', metricKey: { in: campaignIds } },
  select: { metricKey: true, data: true }
});

// Step 3: merge
const snapshotMap = new Map(snapshots.map(s => [s.metricKey, JSON.parse(s.data as string)]));
const rows = campaigns.map(c => {
  const snap = snapshotMap.get(c.id);
  return {
    name: c.name,
    channels: JSON.parse(c.channels || '[]').join(', '),
    status: c.status,
    replyRate: snap ? `${snap.replyRate}%` : 'n/a',
    openRate: snap ? `${snap.openRate}%` : 'n/a',
    leads: snap ? snap.totalLeadsContacted : 'n/a',
  };
});
```

### CachedMetrics Cross-Client Averages for global-insights.md

```typescript
// Source: Prisma schema + live DB audit 2026-03-23
const allSnapshots = await prisma.cachedMetrics.findMany({
  where: { metricType: 'campaign_snapshot' },
  select: { data: true }
});

const parsed = allSnapshots
  .map(s => { try { return JSON.parse(s.data as string); } catch { return null; } })
  .filter(Boolean)
  .filter(d => (d.status === 'completed' || d.status === 'active') && d.totalLeadsContacted > 50);

const emailRows = parsed.filter(d => d.channels?.includes('email') && d.replyRate != null);
const avgReply = emailRows.length
  ? (emailRows.reduce((sum, d) => sum + d.replyRate, 0) / emailRows.length).toFixed(2)
  : 'insufficient data';
```

### .gitignore Entry (Pattern)

```
# Nova agent memory — gitignored to prevent client intelligence leaking to version control
# Directory structure preserved via .gitkeep files
.nova/memory/**/*.md
```

No negation needed — `.gitkeep` files have no extension, so `**/*.md` doesn't match them.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No per-client memory | Flat `.md` files per workspace | Phase 47 (this phase) | Agents start with client context pre-loaded, zero cold-start |
| Hardcoded agent prompts in TypeScript | `.claude/rules/` shared rules files | Phase 46 (complete) | Both CLI and API agents share behavioral rules |
| Manual ICP lookups every session | Seeded `profile.md` read at skill start | Phase 47 + 49 | Profile data always available without DB query at session start |

---

## Open Questions

1. **Which 8 workspaces to target?**
   - What we know: DB has 10 workspace slugs. MEMORY.md lists 8 managed clients. `situ` and `ladder-group` are in DB but not listed as active managed clients.
   - What's unclear: Should seed script skip `situ` and `ladder-group` or include them?
   - Recommendation: **Seed all 10** — the extra two `.gitkeep` directories cost nothing, and `situ` has campaign data in the DB. Future-proofing is worth the small overhead.

2. **Backup strategy (Vercel Blob) is out of scope for Phase 47**
   - What we know: Phase 46 RESEARCH mentioned Vercel Blob backup as a future mechanism. CONTEXT.md for Phase 47 does not mention it.
   - What's unclear: Should `nova-memory.ts` include a `backup` command stub?
   - Recommendation: **No backup in this phase.** Deferred to future. Only `seed` command in Phase 47.

---

## Workspace Data Availability Audit

| Slug | Name | ICP Criteria | Core Offers | Vertical | Campaigns | Reply Data | Seed Quality |
|------|------|-------------|-------------|----------|-----------|------------|--------------|
| myacq | MyAcq | YES | YES | Business Acquisitions | 2 | 90 replies | RICH |
| rise | Rise | NO | YES | Branded Merchandise | 5+ | 96 replies | MEDIUM |
| lime-recruitment | Lime Recruitment | YES | YES | Recruitment Services | 3 | 56 replies | RICH |
| blanktag | BlankTag Media | YES | YES | Paid Media Agency | 1 | 0 replies | GOOD |
| yoopknows | YoopKnows | YES | YES | Architecture PM | 2 | 81 replies | RICH |
| outsignal | Outsignal | NO | YES | B2B Lead Gen | 3 | 100 replies | MEDIUM |
| covenco | Covenco | NO | YES | Enterprise IT | 0 | 0 replies | SPARSE |
| 1210-solutions | 1210 Solutions | YES | YES | Umbrella Company | 0 | 2 replies | GOOD |
| situ | Situ | NO | YES | Serviced Accommodation | 0 | 0 replies | SPARSE |
| ladder-group | Ladder Group | NO | NO | null | 0 | 0 replies | MINIMAL |

**Note:** Sparse/Minimal workspaces still get valid markdown files — placeholders are better than missing files, because skills can still append learnings from scratch.

---

## Sources

### Primary (HIGH confidence)
- Live DB query via Prisma (2026-03-23) — workspace schema fields, campaign fields, CachedMetrics structure, reply counts
- `.nova/ARCHITECTURE.md` (Phase 46 output) — confirms `.nova/memory/{slug}/` path, gitignore strategy, seed script naming
- `47-CONTEXT.md` — locked decisions on 4-file schema, re-seed behavior, governance rules

### Secondary (MEDIUM confidence)
- `.planning/phases/46-skill-architecture-foundation/46-RESEARCH.md` — confirms existing `.claude/commands/nova.md` pattern, `.gitignore` coverage

### Tertiary (LOW confidence)
- None — all claims verified against live DB or project files

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, verified against existing project dependencies
- Architecture: HIGH — confirmed against live DB schema with actual field names
- Pitfalls: HIGH — `.gitignore` pattern and JSON.parse pitfall verified against live CachedMetrics data
- Workspace list: MEDIUM — 10 slugs confirmed in DB; "8 active clients" is project context knowledge, not DB-derived

**Research date:** 2026-03-23
**Valid until:** 2026-04-23 (stable domain — flat files, Prisma schema unlikely to change)
