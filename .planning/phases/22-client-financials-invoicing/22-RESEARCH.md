# Phase 22: Client Financials & Invoicing - Research

**Researched:** 2026-03-04
**Domain:** Invoice management, PDF generation, recurring billing cron, revenue analytics
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Document type & structure
- Invoices only — no quotes needed (existing Proposal/onboarding handles quoting)
- Billing model: package tiers that are monthly retainers
- Two standard line items per invoice: "Cold Outbound Retainer" + "Cold Outbound Platform Fee" (amounts vary by client package)
- Line item descriptions include billing period dates (e.g. "26/01/2026 - 23/02/2026")
- Invoice numbering: client prefix + sequential number (e.g. PS03 = Paytier Solutions, 3rd invoice)
- Currency: GBP only
- Tax: configurable per client (default 0%, can set 20% VAT or other rates)
- Subtotal, tax rate, tax amount, and total shown on invoice

#### Sender details (from)
- Not a company — invoices come from Jonathan personally
- Sender details (name, address, email) stored in admin settings and auto-filled on invoices
- Bank details (account number + sort code) stored in settings, auto-added to PDF notes section
- Must be configurable/editable (not hardcoded)

#### Bill-to details (client)
- Full company name + registered address
- Stored per workspace/client — auto-filled when creating invoice for a workspace
- Need fields: company name, address line 1, address line 2, city, postcode

#### Auto-generation & billing cycle
- System automatically generates invoices on a monthly cycle per client
- Billing cycle starts from when the client first paid (not fixed 1st of month)
- Each workspace needs a `billingStartDate` or `renewalDate` field
- Invoice generated 7 days before renewal date
- 5-day payment terms from invoice date
- If unpaid 48 hours before renewal: Slack alert to admin (NOT automatic inbox cancellation)

#### Client portal visibility
- Clients see a "Billing" tab in their portal at portal.outsignal.ai
- Shows invoice history with status and PDF download
- No accept/reject needed (invoices, not quotes)

#### Invoice delivery
- Admin clicks "Send" button to email invoice
- Branded email via Resend with PDF attached
- Not automatic on creation — admin reviews first, then sends

#### Overdue handling
- Auto-detect overdue invoices (past due date)
- Send reminder email to client when overdue
- Slack notification to admin

#### Payment tracking
- Manual status change — admin marks as "Paid" when bank transfer received
- No Stripe integration (future phase if needed)
- Status workflow: DRAFT → SENT → PAID (with OVERDUE as auto-detected state)

#### Revenue dashboard
- New "Financials" sidebar group with sub-items: Invoices, Revenue
- 4 KPI cards: Total Revenue (paid), Outstanding (unpaid), Monthly Recurring Revenue, Overdue amount
- Line chart showing revenue over time (matching existing admin dashboard style)
- Per-client breakdown table

#### Navigation
- New top-level "Financials" group in admin sidebar
- Sub-items: Invoices (list + create), Revenue (dashboard)

### Claude's Discretion
- Exact PDF layout and styling (should match the Google Doc format closely — clean, professional)
- Revenue chart implementation (Recharts, matching existing dashboard patterns)
- Filter/sort options on invoice list page
- Date range filtering approach on revenue page

### Deferred Ideas (OUT OF SCOPE)
- Stripe payment integration — collect payments online, auto-mark as paid (future phase)
- Automatic inbox cancellation for non-payment — keep as manual admin decision for now
- Multi-currency support (USD, EUR) — GBP only for now
- Recurring invoice templates — the auto-generation covers this use case
- Credit notes / refunds — not needed yet
- Xero/QuickBooks export — future accounting integration
</user_constraints>

---

## Summary

Phase 22 adds a complete invoicing system to Outsignal's admin dashboard, replacing manual Google Docs. The core technical domains are: Prisma schema additions, PDF generation via `@react-pdf/renderer` (already used in the Rise Manufacturing Hub reference project), Resend email delivery with PDF attachment, recurring cron-triggered invoice auto-generation, an admin invoice management UI, a client portal billing tab, and a revenue analytics dashboard using the project's existing Recharts pattern.

The Rise Manufacturing Hub at `/Users/jjay/programs/rise-manufacturing-hub` provides a proven reference for the `FinancialDocument` + `LineItem` Prisma model structure, the `@react-pdf/renderer` PDF route, the `useFinancials` hook pattern, and the financials table component. These patterns should be adapted (not copied verbatim — the Outsignal version is invoices-only and has workspace-scoped billing, not project-scoped).

A critical infrastructure constraint exists: `vercel.json` already uses all 3 Vercel Hobby cron slots. The invoice auto-generation check must be merged into the existing `/api/inbox-health/check` cron route rather than registering a new cron. The cron runs daily at 06:00 UTC, which is appropriate for generating invoices 7 days in advance.

**Primary recommendation:** Use `@react-pdf/renderer` v4.x for PDF generation (same as Rise Manufacturing Hub), merge invoice cron logic into the existing daily health check, and follow the `InvoiceSenderSettings` + `WorkspaceBillingInfo` settings pattern established by the project's existing admin settings page.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-pdf/renderer` | ^4.3.2 | Server-side PDF generation | Already in Rise Manufacturing Hub, React-based DSL for PDF layout, runs in Node.js |
| `prisma` | ^6.19.2 | Database ORM | Already in project — new models added to existing schema |
| `resend` | ^6.9.2 | Email delivery with attachment | Already in project (`src/lib/resend.ts`) |
| `recharts` | ^3.7.0 | Revenue chart | Already in project, used for ActivityChart |
| `zod` | ^4.3.6 | API input validation | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@react-email/components` | (not currently installed) | Rich email templates | Not needed — project uses raw HTML email strings via Resend directly (see `src/lib/resend.ts`). Continue same pattern for invoice email. |
| `sonner` | (not explicitly in package.json) | Toast notifications | Project uses shadcn/radix UI patterns already; toast pattern follows existing form actions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@react-pdf/renderer` | Puppeteer/headless Chrome | Puppeteer is too heavy for Vercel serverless — cold starts, binary size limits. React-PDF is pure Node.js, serverless-safe. |
| `@react-pdf/renderer` | `jsPDF` | jsPDF is canvas-based, limited typographic control. React-PDF gives declarative layout matching the invoice design spec. |
| Merge into existing cron | New Vercel cron | Vercel Hobby plan is capped at 3 crons. `vercel.json` already has 3. Must reuse existing slot. |

**Installation (new packages only):**
```bash
npm install @react-pdf/renderer
```

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
prisma/
└── schema.prisma                          # Add Invoice, LineItem, InvoiceSenderSettings, WorkspaceBillingInfo models

src/
├── app/
│   ├── (admin)/
│   │   ├── financials/
│   │   │   └── page.tsx                   # Invoice list page (admin)
│   │   └── revenue/
│   │       └── page.tsx                   # Revenue dashboard page (admin)
│   ├── (portal)/
│   │   └── portal/
│   │       └── billing/
│   │           └── page.tsx               # Client portal billing tab
│   └── api/
│       ├── invoices/
│       │   ├── route.ts                   # GET (list) + POST (create)
│       │   ├── [id]/
│       │   │   ├── route.ts               # GET + PATCH (status update)
│       │   │   ├── pdf/
│       │   │   │   └── route.ts           # GET → streams PDF bytes
│       │   │   └── send/
│       │   │       └── route.ts           # POST → email invoice via Resend
│       │   └── auto-generate/
│       │       └── route.ts               # POST → internal cron trigger handler
│       ├── invoice-settings/
│       │   └── route.ts                   # GET + PUT for sender settings
│       └── revenue/
│           └── route.ts                   # GET revenue summary + time-series
├── lib/
│   ├── invoices/
│   │   ├── generator.ts                   # Auto-generation logic (next renewal calc, create draft)
│   │   ├── pdf.tsx                        # @react-pdf/renderer Document component
│   │   └── overdue.ts                     # Overdue detection + notification logic
│   └── notifications.ts                   # Extend existing file with invoice notification fns
└── components/
    ├── financials/
    │   ├── invoice-table.tsx              # Admin invoice list table
    │   ├── invoice-form.tsx               # Create/edit invoice form
    │   ├── invoice-status-badge.tsx       # DRAFT/SENT/PAID/OVERDUE badge
    │   └── revenue-chart.tsx              # Revenue line chart (Recharts AreaChart)
    └── portal/
        └── portal-billing-tab.tsx         # Client-facing invoice list
```

### Pattern 1: Prisma Schema — Invoice + Settings Models

**What:** New models that integrate with the existing `Workspace` model.
**When to use:** Core data layer for the entire feature.

```typescript
// prisma/schema.prisma additions

// Stores per-admin sender details for invoices (global, not per-workspace)
model InvoiceSenderSettings {
  id            String   @id @default(cuid())
  senderName    String   // "Jonathan Smith"
  senderAddress String?  // Multi-line address stored as text
  senderEmail   String
  accountNumber String?  // Bank account number
  sortCode      String?  // Bank sort code (e.g. "12-34-56")
  updatedAt     DateTime @updatedAt
}

// Per-workspace billing config (bill-to address + billing cycle)
// Add these fields to the existing Workspace model:
//   billingCompanyName    String?
//   billingAddressLine1   String?
//   billingAddressLine2   String?
//   billingCity           String?
//   billingPostcode       String?
//   invoicePrefix         String?  // e.g. "PS" for Paytier Solutions
//   invoiceTaxRate        Float    @default(0)  // e.g. 20 for 20% VAT
//   billingRenewalDate    DateTime? // Client's monthly renewal date
//   billingDaysBefore     Int      @default(7)  // Generate invoice N days before renewal

model Invoice {
  id              String   @id @default(cuid())
  invoiceNumber   String   @unique  // e.g. "PS03"
  workspaceSlug   String

  // Bill-from (snapshot at creation time from InvoiceSenderSettings)
  senderName      String
  senderAddress   String?
  senderEmail     String
  bankDetails     String?  // "Account: 12345678 | Sort: 12-34-56"

  // Bill-to (snapshot at creation time from workspace billing info)
  clientCompanyName  String
  clientAddress      String?  // Full formatted address

  // Dates
  issueDate       DateTime
  dueDate         DateTime  // issueDate + 5 days
  billingPeriodStart DateTime?  // For line item descriptions
  billingPeriodEnd   DateTime?

  // Financials (stored in pence to avoid float precision issues)
  subtotalPence   Int   @default(0)
  taxRate         Float @default(0)   // e.g. 20.0 for 20%
  taxAmountPence  Int   @default(0)
  totalPence      Int   @default(0)

  // Status: draft | sent | paid | overdue (overdue derived, can be stored)
  status          String   @default("draft")

  // Delivery tracking
  sentAt          DateTime?
  paidAt          DateTime?

  // Auto-generation metadata
  autoGenerated   Boolean  @default(false)
  renewalDate     DateTime?  // The renewal date this invoice was triggered for

  // View token for portal access (no auth required, just valid token)
  viewToken       String?  @unique

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  lineItems       InvoiceLineItem[]

  @@index([workspaceSlug])
  @@index([status])
  @@index([issueDate])
  @@index([dueDate])
  @@index([workspaceSlug, status])
}

model InvoiceLineItem {
  id          String   @id @default(cuid())
  invoiceId   String
  description String   // e.g. "Cold Outbound Retainer (26/01/2026 - 23/02/2026)"
  quantity    Int      @default(1)
  unitPricePence Int   // Price per unit in pence
  amountPence    Int   // quantity * unitPricePence

  invoice     Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
}

model InvoiceSequence {
  id             String  @id @default(cuid())
  workspaceSlug  String  @unique
  lastNumber     Int     @default(0)
}
```

**Currency note:** Store all amounts in integer pence (GBP). Format for display as `£(pence / 100).toFixed(2)`. Avoids floating point drift on financial calculations.

**Alternative:** Rise Manufacturing Hub uses `Decimal @db.Decimal(10,2)`. Either works for Postgres/Prisma. Integer pence is simpler and avoids Prisma Decimal serialization issues in JSON responses.

### Pattern 2: PDF Generation with @react-pdf/renderer

**What:** Server-side PDF rendered in a Next.js API route.
**When to use:** GET `/api/invoices/[id]/pdf`

```typescript
// src/lib/invoices/pdf.tsx
// Source: @react-pdf/renderer official docs + Rise Manufacturing Hub pattern

import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#18181b",
  },
  header: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 32,
  },
  // ... full layout matching Google Doc format described in CONTEXT.md
});

export function InvoicePdfDocument({ invoice }: { invoice: InvoiceWithLineItems }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* INVOICE header */}
        {/* Sender details top-left, bill-to top-right */}
        {/* Invoice # / Date / Due Date / Amount Due row */}
        {/* Line items table */}
        {/* Notes section with bank details */}
        {/* Subtotal / Tax / Total at bottom */}
      </Page>
    </Document>
  );
}

// API route: src/app/api/invoices/[id]/pdf/route.ts
import { renderToBuffer } from "@react-pdf/renderer";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: { lineItems: true }
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buffer = await renderToBuffer(<InvoicePdfDocument invoice={invoice} />);

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
    },
  });
}
```

**Important:** `renderToBuffer` is the correct server-side API. `renderToStream` and `renderToFile` also exist but `renderToBuffer` is cleanest for Next.js API routes returning a `Response`.

### Pattern 3: Invoice Numbering — Sequential Per Workspace

**What:** Atomic sequential number generation using an upsert-and-increment pattern.
**When to use:** On invoice creation.

```typescript
// src/lib/invoices/generator.ts
async function getNextInvoiceNumber(workspaceSlug: string, prefix: string): Promise<string> {
  // Use a transaction to avoid race conditions
  const result = await prisma.$transaction(async (tx) => {
    const seq = await tx.invoiceSequence.upsert({
      where: { workspaceSlug },
      create: { workspaceSlug, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return seq.lastNumber;
  });

  // Format: PREFIX + zero-padded 2-digit number (PS01, PS02, ... PS99, PS100)
  return `${prefix}${String(result).padStart(2, "0")}`;
}
```

### Pattern 4: Auto-Generation Cron — Merged into Existing Daily Check

**What:** Billing cycle check runs daily, finds workspaces due for invoice generation.
**When to use:** Daily cron at 06:00 UTC in `/api/inbox-health/check`.

**Critical constraint:** `vercel.json` already has 3 crons (Hobby limit). Cannot add a 4th. Must add invoice generation to the existing `/api/inbox-health/check` route.

```typescript
// src/lib/invoices/generator.ts

export async function generateDueInvoices(): Promise<{ created: number; skipped: number }> {
  const today = new Date();
  const sevenDaysFromNow = new Date(today);
  sevenDaysFromNow.setDate(today.getDate() + 7);

  // Find workspaces with billingRenewalDate within the next 7 days
  const workspaces = await prisma.workspace.findMany({
    where: {
      billingRenewalDate: {
        gte: today,
        lte: sevenDaysFromNow,
      },
    },
  });

  let created = 0;
  let skipped = 0;

  for (const workspace of workspaces) {
    // Skip if a draft/sent invoice already exists for this renewal date
    const existing = await prisma.invoice.findFirst({
      where: {
        workspaceSlug: workspace.slug,
        renewalDate: workspace.billingRenewalDate,
        status: { in: ["draft", "sent"] },
      },
    });

    if (existing) { skipped++; continue; }

    await createInvoiceDraft(workspace);
    created++;
  }

  return { created, skipped };
}
```

**Billing renewal date advancement:** After generating the invoice (or after marking paid), advance `billingRenewalDate` by 1 month. Use `date-fns` `addMonths()` or manual calculation — no new library needed.

### Pattern 5: Resend Email with PDF Attachment

**What:** Attach PDF buffer to a Resend email.
**When to use:** POST `/api/invoices/[id]/send`

```typescript
// src/lib/invoices/send-invoice-email.ts
// Resend v3+ supports attachments via the `attachments` field

import { renderToBuffer } from "@react-pdf/renderer";
import { Resend } from "resend";

export async function sendInvoiceEmail(invoice: InvoiceWithLineItems): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const pdfBuffer = await renderToBuffer(<InvoicePdfDocument invoice={invoice} />);

  await resend.emails.send({
    from: process.env.RESEND_FROM ?? "Outsignal <notifications@outsignal.ai>",
    to: [clientEmail],
    subject: `Invoice ${invoice.invoiceNumber} from Outsignal`,
    html: invoiceEmailHtml(invoice),
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
}
```

**Confidence note:** Resend attachment API confirmed in Resend docs: `attachments` field accepts `{ filename, content }` where `content` is a `Buffer` or `base64` string. The project already uses `resend@^6.9.2` which supports this.

### Pattern 6: Overdue Detection

**What:** Invoices past their `dueDate` with status `sent` are considered overdue.
**When to use:** Either computed on read (no stored state) or updated by the daily cron.

Recommendation: Run overdue detection in the same daily cron. Update `status = "overdue"` in DB for any `sent` invoices past their `dueDate`. This makes queries/filtering simple and avoids computing it on every read.

```typescript
// src/lib/invoices/overdue.ts
export async function markAndNotifyOverdueInvoices(): Promise<void> {
  const now = new Date();

  const overdue = await prisma.invoice.findMany({
    where: {
      status: "sent",
      dueDate: { lt: now },
    },
  });

  for (const invoice of overdue) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "overdue" },
    });

    // Reminder email to client
    await sendOverdueReminderEmail(invoice);

    // Slack alert to admin
    await notifyAdminOverdueInvoice(invoice);
  }
}
```

### Pattern 7: Workspace Billing Fields + Sender Settings

**What:** Two new settings areas.
**When to use:**
1. Admin-level InvoiceSenderSettings (Jonathan's personal details) — add to Settings page or new "Invoice Settings" card
2. Per-workspace billing address — add fields to existing Workspace settings form

**Key decision:** Add billing fields directly to the `Workspace` model (consistent with project pattern of many fields on Workspace) rather than creating a separate `WorkspaceBillingInfo` table.

### Pattern 8: Admin Sidebar — Financials Group

**What:** Add "Financials" group to `STATIC_NAV_GROUPS` in `src/components/layout/sidebar.tsx`.
**When to use:** During UI implementation.

```typescript
// In STATIC_NAV_GROUPS array, before "workspaces" (inserted dynamically):
{
  key: "financials",
  label: "Financials",
  collapsible: true,
  tier: "secondary",
  items: [
    { href: "/financials", label: "Invoices", icon: FileText },
    { href: "/revenue", label: "Revenue", icon: TrendingUp },
  ],
},
```

`DollarSign` is already imported in sidebar.tsx. Add `FileText` and `TrendingUp` from `lucide-react`.

### Pattern 9: Portal Billing Tab

**What:** Add `/portal/billing` page and sidebar nav item.
**When to use:** Client portal UI.

```typescript
// src/components/portal/portal-sidebar.tsx — add to navItems:
{ href: "/portal/billing", label: "Billing", icon: Receipt },

// src/app/(portal)/portal/billing/page.tsx
// Uses getPortalSession() to get workspaceSlug
// Queries invoices where workspaceSlug matches
// Shows table with: Invoice #, Date, Due Date, Amount, Status, PDF download link
// PDF link: /api/invoices/[id]/pdf?token=[viewToken] (token-gated, no full auth needed)
```

### Anti-Patterns to Avoid

- **Float currency arithmetic:** Never store amounts as `Float`. Use integer pence. `£500.00` → store as `50000`.
- **Auto-sending invoices:** Admin must click Send. Never trigger email on creation.
- **Storing overdue as computed:** The daily cron should write `status = "overdue"` to the DB, not derive it from `dueDate` on every query. Makes filtering, counting, and KPIs simpler.
- **New Vercel cron route:** The Vercel Hobby plan supports exactly 3 crons. The `vercel.json` already has 3. Do not add a 4th cron route — merge into `/api/inbox-health/check`.
- **Blocking PDF on list page load:** PDF generation is CPU-intensive. Always generate on-demand at `/api/invoices/[id]/pdf`, never at list-page load time.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF layout | Custom HTML-to-PDF | `@react-pdf/renderer` | Vercel serverless has no Chrome/headless browser. React-PDF is pure Node.js, A4 layout control, no binary deps. |
| Sequential invoice numbering with race safety | Application-level counter | Prisma `$transaction` with `increment` upsert | DB-level atomicity prevents duplicate numbers under concurrent requests |
| Email with attachment | Hand-build MIME | Resend `attachments` field | Resend handles MIME encoding, attachment limits, bounce handling |
| GBP formatting | Custom formatter | `Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })` | Built-in, handles edge cases (pence rounding, locale display) |
| Date arithmetic for billing cycles | Custom month-add | Native `Date` with careful month-end handling | Months have variable lengths — adding 30 days will drift; use month addition |

**Key insight:** The most dangerous place to hand-roll in this phase is currency arithmetic (float precision) and invoice numbering (concurrency). Both have correct solutions that are trivial to implement correctly.

---

## Common Pitfalls

### Pitfall 1: Vercel Cron Limit
**What goes wrong:** Developer adds a new cron route for invoice generation, deploy fails or silently drops an existing cron.
**Why it happens:** Vercel Hobby is capped at 3 crons. The project already uses all 3 (`/api/enrichment/jobs/process`, `/api/inbox-health/check`, `/api/linkedin/maintenance`).
**How to avoid:** Add `generateDueInvoices()` and `markAndNotifyOverdueInvoices()` calls inside the existing `/api/inbox-health/check` GET handler. Pattern already exists — it calls multiple maintenance functions.
**Warning signs:** `vercel.json` has a 4th cron entry.

### Pitfall 2: Float Currency Drift
**What goes wrong:** `0.1 + 0.2 = 0.30000000000000004` — subtotals don't match totals, tax calculations are slightly wrong.
**Why it happens:** IEEE 754 floating point representation of decimals.
**How to avoid:** Store all amounts as integer pence. `£500.00 → 50000`. Only format to string for display: `(pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP' })`.
**Warning signs:** Using `Float` type in Prisma schema for financial amounts.

### Pitfall 3: @react-pdf/renderer in Next.js App Router
**What goes wrong:** `TypeError: Cannot use import statement outside a module` or `window is not defined` errors when importing from a server route.
**Why it happens:** React-PDF has some browser-targeting in its build; Next.js App Router needs explicit server-only handling.
**How to avoid:** Always use React-PDF only in API route files (not in client components). Use `renderToBuffer` (not `renderToStream`) in App Router. Mark the PDF module with `"use server"` or keep it in `/lib/invoices/pdf.tsx` imported only from API routes.
**Warning signs:** Importing `@react-pdf/renderer` inside a `"use client"` component.

### Pitfall 4: Billing Cycle Date Drift
**What goes wrong:** Client starts 2026-01-15. After adding 30 days: 2026-02-14. After another 30: 2026-03-16. Renewal date drifts away from the original 15th.
**Why it happens:** Adding fixed day counts instead of month increments.
**How to avoid:** Store the original `billingRenewalDate`. Each month, advance it by exactly 1 calendar month: `new Date(date.getFullYear(), date.getMonth() + 1, date.getDate())`. Handle month-end edge cases (Jan 31 → Feb 28/29).
**Warning signs:** `billingRenewalDate.setDate(billingRenewalDate.getDate() + 30)`.

### Pitfall 5: Duplicate Invoice Generation
**What goes wrong:** Cron runs twice (retry, deployment overlap), creates two DRAFT invoices for the same renewal date.
**Why it happens:** No idempotency guard on the generator.
**How to avoid:** Before creating, check for an existing invoice with `{ workspaceSlug, renewalDate, status: { in: ['draft', 'sent'] } }`. If found, skip.
**Warning signs:** No existence check before `prisma.invoice.create()` in the generator.

### Pitfall 6: 48h Unpaid Alert vs Overdue Alert
**What goes wrong:** Both alerts fire for the same invoice, creating duplicate Slack noise.
**Why it happens:** The "48h before renewal unpaid" alert and the "overdue" alert are different checks with potentially overlapping windows.
**How to avoid:** The 48h alert fires when `status = 'sent'` AND `dueDate` is in 0-2 days from now AND `renewalDate` is in 0-2 days. The overdue alert fires when `status = 'sent'` AND `dueDate` has passed. These are distinct states — an invoice can trigger both in sequence if still unpaid after due date. This is intentional per spec. Add an `alertedAt` field to track whether a reminder has been sent to prevent duplicate reminders for the same overdue state.

---

## Code Examples

### GBP Formatting Utility

```typescript
// src/lib/invoices/format.ts
export function formatGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

export function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}
```

### Revenue Dashboard Queries

```typescript
// src/app/api/revenue/route.ts
const [paidInvoices, sentInvoices, overdueInvoices] = await Promise.all([
  prisma.invoice.aggregate({
    where: { status: "paid" },
    _sum: { totalPence: true },
  }),
  prisma.invoice.aggregate({
    where: { status: "sent" },
    _sum: { totalPence: true },
  }),
  prisma.invoice.aggregate({
    where: { status: "overdue" },
    _sum: { totalPence: true },
  }),
]);

// MRR: sum of all active workspace total invoice amounts in the most recent month
```

### Revenue Line Chart (Recharts AreaChart — matches ActivityChart)

```typescript
// src/components/financials/revenue-chart.tsx
// "use client"
// Follows exact same pattern as src/components/dashboard/activity-chart.tsx

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// X-axis: month (YYYY-MM), Y-axis: total revenue in pounds
// Single area: "revenue" in brand color oklch(0.85 0.12 110) (#F0FF7A variant)
// formatYAxis: (value) => `£${value.toLocaleString()}`
```

### Invoice Auto-Generate Hook in Existing Cron

```typescript
// src/app/api/inbox-health/check/route.ts — add to existing GET handler:
import { generateDueInvoices } from "@/lib/invoices/generator";
import { markAndNotifyOverdueInvoices } from "@/lib/invoices/overdue";

// Inside the try block after existing checks:
const invoiceResult = await generateDueInvoices();
await markAndNotifyOverdueInvoices();
console.log(`[invoices] Generated ${invoiceResult.created} invoices, skipped ${invoiceResult.skipped}`);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Puppeteer for PDF | `@react-pdf/renderer` | ~2020 | Serverless-safe, no binary deps, declarative layout |
| `nodemailer` for email | `resend` SDK | ~2023 | Already in project, simpler API, better deliverability |
| Manual float math | Integer pence storage | Always best practice | Eliminates rounding bugs on financial calculations |

**Deprecated/outdated:**
- `pdfmake`: Canvas-based, limited typographic control, less React-friendly.
- `html-pdf` / `html2pdf`: Requires headless Chrome, not viable on Vercel serverless.

---

## Open Questions

1. **Invoice PDF attachment size limit (Resend)**
   - What we know: Resend allows attachments. Standard PDF invoice is ~50-200KB.
   - What's unclear: Whether Resend free/paid tier has attachment size limits.
   - Recommendation: Assume no issue for a 1-2 page invoice PDF. If Resend blocks it, the fallback is to send a link to `/api/invoices/[id]/pdf?token=[viewToken]` instead of attaching.

2. **`billingRenewalDate` initial population**
   - What we know: 6 existing clients need their initial renewal date set.
   - What's unclear: Whether the planner should include a one-time migration/seed step.
   - Recommendation: Include a plan task for admin to manually set `billingRenewalDate` for existing workspaces via the workspace settings form. No automated migration needed — there are only 6 clients.

3. **48h unpaid alert: what Slack channel?**
   - What we know: Admin Slack notifications use `ADMIN_SLACK_CHANNEL_ID` (established in Phase 18). Per context: "Slack alert to admin" (not client channel).
   - What's unclear: Whether to use the workspace-specific channel or a single admin/ops channel.
   - Recommendation: Use `ADMIN_SLACK_CHANNEL_ID` (ops channel) for the 48h unpaid alert — consistent with Phase 18's budget alerts pattern. The admin is the same person across all workspaces, and this is an internal ops concern, not client-facing.

4. **Portal billing access — view token vs. portal session**
   - What we know: Portal uses cookie-based session via `getPortalSession()`. The portal billing tab is gated by this session (client must be logged in).
   - What's unclear: Whether the PDF download link should require session auth or use a signed `viewToken` (like proposals use).
   - Recommendation: Use portal session auth for the billing tab page. For the PDF download specifically, use a `viewToken` stored on the invoice (same pattern as Rise Manufacturing Hub `viewToken` field). This allows direct PDF download links in emails without requiring portal login.

---

## Sources

### Primary (HIGH confidence)
- `/Users/jjay/programs/rise-manufacturing-hub/prisma/schema.prisma` — `FinancialDocument`, `LineItem`, `DocumentSequence` model patterns
- `/Users/jjay/programs/rise-manufacturing-hub/src/components/financials/financial-document-dialog.tsx` — Form pattern, line item management, totals calculation
- `/Users/jjay/programs/rise-manufacturing-hub/src/hooks/use-financials.ts` — CRUD hook pattern with toast notifications
- `/Users/jjay/programs/rise-manufacturing-hub/src/app/(dashboard)/dashboard/financials/financials-client.tsx` — Table + SlideOver detail pattern, PDF download button
- `/Users/jjay/programs/outsignal-agents/src/components/layout/sidebar.tsx` — NavGroup pattern, DollarSign icon already imported
- `/Users/jjay/programs/outsignal-agents/src/components/dashboard/activity-chart.tsx` — Recharts AreaChart pattern to match
- `/Users/jjay/programs/outsignal-agents/src/lib/resend.ts` — Email delivery pattern (HTML strings, not react-email)
- `/Users/jjay/programs/outsignal-agents/src/lib/cron-auth.ts` — `validateCronSecret` pattern
- `/Users/jjay/programs/outsignal-agents/vercel.json` — Confirms 3 crons already used (Hobby limit)
- `/Users/jjay/programs/outsignal-agents/package.json` — Confirms `resend@^6.9.2`, `recharts@^3.7.0`, no PDF library yet
- `/Users/jjay/programs/rise-manufacturing-hub/package.json` — Confirms `@react-pdf/renderer@^4.3.2` is the reference project's choice

### Secondary (MEDIUM confidence)
- Resend docs (from training knowledge, v6.x): `attachments` field accepts `{ filename, content: Buffer }` in `emails.send()`
- `@react-pdf/renderer` v4.x: `renderToBuffer(element)` returns `Promise<Buffer>`, suitable for Next.js API routes. Confirmed from project usage in Rise Manufacturing Hub.

### Tertiary (LOW confidence)
- Vercel Hobby plan cron limit of 3: Confirmed from `vercel.json` showing exactly 3 entries. The limit itself is from Vercel docs (training knowledge, verify if upgrading plan is considered).

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already used in this project or the Rise Manufacturing Hub reference
- Architecture: HIGH — all patterns derived from existing code in the two projects
- Pitfalls: HIGH — derived from direct codebase inspection (vercel.json cron count, existing float patterns, portal auth pattern)

**Research date:** 2026-03-04
**Valid until:** 2026-06-04 (stable libraries, 90-day estimate)
