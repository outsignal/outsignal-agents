---
phase: quick
plan: 4
type: execute
wave: 1
depends_on: []
files_modified:
  - prisma/schema.prisma
  - src/app/api/platform-costs/route.ts
  - src/app/(admin)/platform-costs/page.tsx
  - src/components/layout/sidebar.tsx
autonomous: true
requirements: [QUICK-4]

must_haves:
  truths:
    - "Admin can view total monthly burn across all platform services in GBP"
    - "Admin can see per-service monthly cost breakdown with client tagging"
    - "Admin can inline-edit cost figures and notes"
    - "Sidebar has Platform Costs link under System group"
    - "~25 services seeded from actual expense data"
  artifacts:
    - path: "prisma/schema.prisma"
      provides: "PlatformCost model with @@unique([service, client])"
      contains: "model PlatformCost"
    - path: "src/app/api/platform-costs/route.ts"
      provides: "GET and PUT endpoints for platform costs"
      exports: ["GET", "PUT"]
    - path: "src/app/(admin)/platform-costs/page.tsx"
      provides: "Platform costs dashboard page"
  key_links:
    - from: "src/app/(admin)/platform-costs/page.tsx"
      to: "/api/platform-costs"
      via: "fetch in useEffect"
      pattern: "fetch.*api/platform-costs"
    - from: "src/app/api/platform-costs/route.ts"
      to: "prisma.platformCost"
      via: "database query"
      pattern: "prisma\\.platformCost"
---

<objective>
Create a Platform Costs dashboard page at /platform-costs that tracks all recurring service expenses in GBP.

Purpose: Give the admin a single view of monthly burn across ~25 services with per-client cost tagging (some costs are shared, others client-specific like CheapInboxes). Currency is GBP (£).

Output: New admin page with API route, Prisma model, sidebar link, and ~25 seeded entries from actual expense data.
</objective>

<execution_context>
@/Users/jjay/.claude/get-shit-done/workflows/execute-plan.md
@/Users/jjay/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@prisma/schema.prisma
@src/app/(admin)/enrichment-costs/page.tsx (reference page pattern — use same UI component library, layout style, card density, color palette)
@src/components/layout/sidebar.tsx (add nav item)
@src/app/api/enrichment/costs/route.ts (reference API pattern)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add PlatformCost model and create API route with seed data</name>
  <files>
    prisma/schema.prisma
    src/app/api/platform-costs/route.ts
  </files>
  <action>
1. Add PlatformCost model to schema.prisma:
   ```
   model PlatformCost {
     id          String   @id @default(cuid())
     service     String            // "cheapinboxes", "clay", "vercel"
     label       String            // "CheapInboxes (Rise)", "Clay"
     monthlyCost Float             // GBP per month
     notes       String?           // "Pro plan", "Starter"
     category    String   @default("infrastructure") // infrastructure | api | email | tools
     client      String?           // workspace slug or null = shared
     url         String?           // link to service dashboard
     updatedAt   DateTime @updatedAt
     createdAt   DateTime @default(now())

     @@unique([service, client])
   }
   ```
   Run `npx prisma db push` after adding the model.

2. Create API route at src/app/api/platform-costs/route.ts:
   - Use requireAdminAuth() (import from src/lib/auth — same pattern as other admin API routes like src/app/api/enrichment/costs/route.ts)
   - GET: Returns all PlatformCost records ordered by category, then client nulls first, then label. If no records exist, seed these ~25 entries:

   TOOLS (category: "tools"):
   - { service: "slack", label: "Slack", monthlyCost: 8.40, client: null }
   - { service: "google-workspace", label: "Google Workspace (Melhu)", monthlyCost: 14.00, client: "melhu" }
   - { service: "google-workspace", label: "Google Workspace (Outsignal)", monthlyCost: 28.00, client: "outsignal" }
   - { service: "claude-ai", label: "Claude AI", monthlyCost: 18.00, client: null, notes: "Pro plan" }
   - { service: "framer", label: "Framer", monthlyCost: 18.00, client: null, notes: "Website builder" }
   - { service: "loom", label: "Loom", monthlyCost: 13.71, client: null }
   - { service: "sketch", label: "Sketch", monthlyCost: 13.69, client: null }
   - { service: "upwork", label: "Upwork", monthlyCost: 18.61, client: null, notes: "Freelancer fees" }

   API (category: "api"):
   - { service: "leadmagic", label: "LeadMagic", monthlyCost: 44.42, client: null }
   - { service: "prospeo", label: "Prospeo", monthlyCost: 36.01, client: null }
   - { service: "clay", label: "Clay", monthlyCost: 266.31, client: null, notes: "Cancelling soon" }
   - { service: "apify", label: "Apify", monthlyCost: 23.00, client: null, notes: "Starter plan", url: "https://console.apify.com" }
   - { service: "anthropic-api", label: "Anthropic API", monthlyCost: 0, client: null, notes: "Pay-per-use", url: "https://console.anthropic.com" }

   EMAIL (category: "email"):
   - { service: "cheapinboxes", label: "CheapInboxes (YoopKnows)", monthlyCost: 34.37, client: "yoopknows" }
   - { service: "cheapinboxes", label: "CheapInboxes (Rise)", monthlyCost: 52.03, client: "rise", notes: "4 charges combined" }
   - { service: "cheapinboxes", label: "CheapInboxes (StingBox)", monthlyCost: 52.94, client: "stingbox" }
   - { service: "cheapinboxes", label: "CheapInboxes (Lime)", monthlyCost: 51.11, client: "lime-recruitment" }
   - { service: "cheapinboxes", label: "CheapInboxes (MyAcq)", monthlyCost: 51.11, client: "myacq" }
   - { service: "cheapinboxes", label: "CheapInboxes (Outsignal)", monthlyCost: 68.15, client: "outsignal" }
   - { service: "emailbison", label: "EmailBison", monthlyCost: 378.12, client: null, notes: "White-label" }
   - { service: "resend", label: "Resend", monthlyCost: 0, client: null, notes: "Free tier" }

   INFRASTRUCTURE (category: "infrastructure"):
   - { service: "vercel", label: "Vercel", monthlyCost: 16.00, client: null, notes: "Pro plan", url: "https://vercel.com/dashboard" }
   - { service: "trigger-dev", label: "Trigger.dev", monthlyCost: 0, client: null, notes: "Free tier", url: "https://cloud.trigger.dev" }
   - { service: "neon", label: "Neon", monthlyCost: 0, client: null, notes: "Free tier", url: "https://console.neon.tech" }
   - { service: "railway", label: "Railway", monthlyCost: 5.00, client: null, notes: "LinkedIn worker", url: "https://railway.app/dashboard" }

   - Response shape: { services: PlatformCost[], totalMonthly: number, byCategory: Record<string, number>, byClient: Record<string, number> }
   - PUT: Accepts { id: string, monthlyCost: number, notes?: string }, validates monthlyCost >= 0, updates the record, returns updated record.
  </action>
  <verify>
    <automated>cd /Users/jjay/programs/outsignal-agents && npx prisma db push --accept-data-loss 2>&1 | tail -5</automated>
  </verify>
  <done>PlatformCost model exists in DB with @@unique([service, client]), GET endpoint returns ~25 seeded services with totalMonthly/byCategory/byClient aggregations, PUT endpoint updates individual costs</done>
</task>

<task type="auto">
  <name>Task 2: Build Platform Costs dashboard page and add sidebar link</name>
  <files>
    src/app/(admin)/platform-costs/page.tsx
    src/components/layout/sidebar.tsx
  </files>
  <action>
1. Create page at src/app/(admin)/platform-costs/page.tsx as a "use client" component. Follow the enrichment-costs page pattern exactly for component structure, imports, styling conventions:
   - Use Header component with title="Platform Costs" description="Monthly service expenses (GBP)"
   - Use Card, CardContent, CardHeader, CardTitle from @/components/ui/card with density="compact"
   - Use ErrorBanner for error state, same skeleton pattern for loading

2. Layout:
   - **Summary cards row** (grid-cols-2 lg:grid-cols-4 gap-4):
     - Total Monthly Burn (sum of all monthlyCost, large text, text-brand-strong)
     - Shared Costs (where client is null)
     - Client-Specific (where client is not null)
     - Services count

   - **Services table** in a Card:
     - Columns: Service (with colored category dot + label), Client (slug or "Shared" badge), Monthly Cost (£), Notes
     - Monthly Cost column: show as "£XX.XX" — when clicked, becomes an inline Input (type="number", step="0.01", min="0") that saves on blur or Enter key via PUT to /api/platform-costs
     - Notes column: similarly inline-editable on click, saves on blur
     - Service label is a link (opens url in new tab) if url exists
     - Category dot colors: infrastructure = oklch(0.714 0.143 215.221) (blue), api = oklch(0.82 0.148 68) (amber), email = oklch(0.845 0.143 155) (green), tools = oklch(0.714 0.143 310) (purple)
     - Group rows visually by category with a subtle category header row (text-xs uppercase text-muted-foreground bg-muted/30)
     - Show category subtotals in header rows

   - **No charts needed** — this is a simple cost tracker

3. Inline edit behavior:
   - Click on cost or notes cell -> transforms to Input
   - On blur or Enter -> PUT /api/platform-costs with { id, monthlyCost, notes }
   - Show brief "Saved" indicator (green checkmark that fades after 1.5s)
   - On error -> show toast or inline error text
   - Optimistic update: immediately update local state, revert on error

4. Add sidebar link in src/components/layout/sidebar.tsx:
   - Add to the System group items array, after "Enrichment Costs" (line ~174):
     `{ href: "/platform-costs", label: "Platform Costs", icon: Wallet }`
   - Import Wallet from lucide-react (add to existing import line)
  </action>
  <verify>
    <automated>cd /Users/jjay/programs/outsignal-agents && npx next build 2>&1 | tail -10</automated>
  </verify>
  <done>Platform Costs page renders with summary cards and editable services table grouped by category, sidebar shows "Platform Costs" link under System group, inline editing saves to database via PUT endpoint, client column shows workspace slug or "Shared", all costs in GBP</done>
</task>

</tasks>

<verification>
- `npx prisma db push` succeeds
- `npx next build` completes without errors
- /platform-costs page loads showing ~25 seeded services grouped by 4 categories
- Summary cards show correct totals (~£1,213 total)
- Client column shows workspace slug or "Shared" badge
- Clicking a cost cell enables inline editing; saving updates the value
- Sidebar shows Platform Costs link in System group
</verification>

<success_criteria>
Admin can navigate to /platform-costs, see all ~25 services with their monthly costs in GBP grouped by category, with client tagging, edit any cost/notes inline, and see the total monthly burn update accordingly.
</success_criteria>

<output>
After completion, create `.planning/quick/4-platform-costs-dashboard-page/4-SUMMARY.md`
</output>
