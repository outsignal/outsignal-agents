---
phase: 22-client-financials-invoicing
verified: 2026-03-04T23:45:00Z
status: gaps_found
score: 4/5 success criteria verified
gaps:
  - truth: "Invoice status workflow enforces valid transitions (DRAFT → SENT → PAID) with OVERDUE auto-detection, reminder emails, and 48h unpaid renewal alerts"
    status: partial
    reason: "The overdue reminder email CTA in src/lib/invoices/overdue.ts links to /portal/invoices/${viewToken} — a page that does not exist. The portal billing route is /portal/billing. Clicking the reminder email CTA gives clients a 404."
    artifacts:
      - path: "src/lib/invoices/overdue.ts"
        issue: "Lines 17-20: viewUrl points to '${portalBase}/portal/invoices/${invoice.viewToken}' but no /portal/invoices/[token] page exists. The correct URL is either /portal/billing or the PDF endpoint /api/invoices/${id}/pdf?token=${viewToken}."
    missing:
      - "Fix the viewUrl in sendOverdueReminderEmail() to use a valid URL — either '/portal/billing' (so client sees their billing page) or the PDF API endpoint '/api/invoices/${invoice.id}/pdf?token=${invoice.viewToken}' (consistent with how email.ts handles it)"
human_verification:
  - test: "Invoice PDF rendering"
    expected: "GET /api/invoices/{id}/pdf returns a downloadable A4 PDF with two-column header, metadata bar, line items table, totals section, and bank details notes section"
    why_human: "PDF visual quality cannot be verified by grep — requires opening the rendered PDF"
  - test: "Invoice email delivery"
    expected: "POST /api/invoices/{id}/send delivers branded HTML email with PDF attached via Resend; recipient email matches workspace billingClientEmail"
    why_human: "Requires Resend API live call to verify delivery; email client rendering cannot be verified programmatically"
  - test: "New Invoice form — real-time totals"
    expected: "When workspace is selected, line items pre-populate from billingRetainerPence/billingPlatformFeePence; subtotal/tax/total update in real-time as values change"
    why_human: "Client-side React interactivity cannot be verified by static analysis"
  - test: "Revenue dashboard — empty state vs populated"
    expected: "KPI cards show correct GBP values; monthly chart renders area curve; per-client table shows rows when paid invoices exist"
    why_human: "Requires live data in DB and browser rendering to verify chart appearance"
---

# Phase 22: Client Financials & Invoicing Verification Report

**Phase Goal:** Admins can create invoices for clients directly in the dashboard, generate branded PDFs, email invoices with PDF attached, track payment status, and view revenue analytics — eliminating the current Google Docs manual invoicing process
**Verified:** 2026-03-04T23:45:00Z
**Status:** gaps_found (1 gap — overdue reminder email dead link)
**Re-verification:** No — initial verification

## Goal Achievement

### Success Criteria (from ROADMAP)

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | Admin can create an invoice for any workspace client with line items, tax, and auto-generated document numbers | VERIFIED | `src/app/(admin)/financials/page.tsx` fetches `/api/invoices` + workspaces; `InvoiceForm` POSTs to `/api/invoices`; `createInvoice()` generates atomic number via `prisma.$transaction` |
| 2 | Admin can generate and download a branded PDF for any invoice | VERIFIED | `GET /api/invoices/[id]/pdf` uses `renderToBuffer(InvoicePdfDocument)` — A4, INVOICE title, two-column header, metadata bar, line items table, totals section, bank details notes |
| 3 | Admin can email invoice via Resend with PDF attached; client can view and download via portal billing tab | VERIFIED | `sendInvoiceEmail()` sends via `resend.emails.send()` with `attachments`; portal billing page at `/portal/billing` shows non-draft invoices with PDF download links using `viewToken` |
| 4 | Dashboard shows revenue KPIs (Total Revenue, Outstanding, MRR, Overdue) with monthly breakdown chart and per-client breakdown | VERIFIED | `GET /api/revenue` returns all 4 KPIs + `timeSeries` + `clientBreakdown`; `/revenue` page renders 4 MetricCards + RevenueChart (Recharts AreaChart) + per-client table |
| 5 | Invoice status workflow enforces valid transitions (DRAFT → SENT → PAID) with OVERDUE auto-detection, reminder emails, and 48h unpaid renewal alerts | PARTIAL | VALID_TRANSITIONS enforced in `updateInvoiceStatus()`; overdue detection wired in daily cron; 48h alert works; BUT overdue reminder email CTA links to dead URL `/portal/invoices/${viewToken}` |

**Score:** 4/5 success criteria verified (1 partial)

---

## Required Artifacts

### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `prisma/schema.prisma` | Invoice, InvoiceLineItem, InvoiceSequence, InvoiceSenderSettings models + Workspace billing fields | VERIFIED | All 4 models present (lines 949-1035); 13 billing fields on Workspace model |
| `src/lib/invoices/types.ts` | InvoiceStatus, InvoiceWithLineItems, CreateInvoiceInput, InvoiceSenderSettingsData | VERIFIED | All 4 exports present + VALID_TRANSITIONS map |
| `src/lib/invoices/format.ts` | formatGBP, penceToPounds | VERIFIED | All 3 exports present; Intl.NumberFormat GBP implementation |
| `src/lib/invoices/numbering.ts` | getNextInvoiceNumber | VERIFIED | Atomic upsert via `prisma.$transaction` |
| `src/lib/invoices/operations.ts` | createInvoice, updateInvoiceStatus, getInvoice, listInvoices | VERIFIED | All 5 operations + advanceRenewalDate + getInvoiceByToken |

### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/invoices/route.ts` | GET, POST | VERIFIED | GET filters by workspaceSlug/status; POST validates + calls createInvoice, returns 201 |
| `src/app/api/invoices/[id]/route.ts` | GET, PATCH | VERIFIED | GET supports ?token= fallback; PATCH validates status + calls updateInvoiceStatus, returns 400 on invalid transition |
| `src/app/api/invoices/[id]/pdf/route.ts` | GET | VERIFIED | renderToBuffer with as-any cast; returns application/pdf with Content-Disposition |
| `src/app/api/invoices/[id]/send/route.ts` | POST | VERIFIED | Fetches workspace.billingClientEmail, calls sendInvoiceEmail, updates status to "sent" |
| `src/app/api/invoice-settings/route.ts` | GET, PUT | VERIFIED | GET findFirst; PUT upsert pattern (find existing → update or create) |
| `src/lib/invoices/pdf.tsx` | InvoicePdfDocument | VERIFIED | Full A4 layout: title, two-column header, metadata bar, line items table with alternating rows, right-aligned totals with bold total row (#F0FF7A brand color), bank details notes section |
| `src/lib/invoices/email.ts` | sendInvoiceEmail, invoiceEmailHtml | VERIFIED | invoiceEmailHtml builds branded HTML (OUTSIGNAL header, invoice details, amount/due date, CTA button, footer); sendInvoiceEmail generates PDF buffer + sends via Resend with attachment |

### Plan 03 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/invoices/generator.ts` | generateDueInvoices, alertUnpaidBeforeRenewal | VERIFIED | 7-day window; idempotency guard (workspaceSlug + renewalDate + draft/sent status); builds line items from billingRetainerPence/billingPlatformFeePence; 48h alert via notify() |
| `src/lib/invoices/overdue.ts` | markAndNotifyOverdueInvoices | PARTIAL | Correctly marks status=overdue; reminderSentAt guard prevents duplicate emails; admin Slack alert works; BUT sendOverdueReminderEmail() uses dead URL `/portal/invoices/${viewToken}` |
| `src/app/api/inbox-health/check/route.ts` | Contains generateDueInvoices call | VERIFIED | All 3 imports + calls present (lines 8-9, 155-170); invoicesGenerated/invoicesSkipped/overdueInvoices/unpaidRenewalAlerts added to response JSON |

### Plan 04 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/layout/sidebar.tsx` | Contains "financials" group | VERIFIED | FileText + TrendingUp imported; Financials group with /financials and /revenue items at lines 137-144 |
| `src/app/(admin)/financials/page.tsx` | Invoice list page | VERIFIED | 156 lines; fetches /api/invoices + /api/workspaces; filter bar with workspace/status dropdowns; InvoiceTable + InvoiceForm |
| `src/components/financials/invoice-form.tsx` | InvoiceForm | VERIFIED | Dialog with workspace selector, issue date, billing period, dynamic line items, real-time totals preview; auto-populates from workspace billing config |
| `src/components/financials/invoice-table.tsx` | Invoice table | VERIFIED | Columns: Invoice#, Client, Issue Date, Due Date, Total (GBP), Status, Actions; PDF/Send/MarkPaid action buttons with correct conditional visibility |
| `src/components/financials/invoice-status-badge.tsx` | InvoiceStatusBadge | VERIFIED | Color-coded: draft=outline, sent=blue, paid=emerald, overdue=destructive |
| `src/app/(admin)/revenue/page.tsx` | Revenue dashboard | VERIFIED | 190 lines; 4 MetricCard KPIs; RevenueChart; per-client Table |
| `src/components/financials/revenue-chart.tsx` | RevenueChart | VERIFIED | Recharts AreaChart pattern matching ActivityChart; brand color oklch(0.75 0.18 110); custom tooltip with formatGBP |
| `src/app/api/revenue/route.ts` | GET revenue API | VERIFIED | totalRevenuePence, outstandingPence, overduePence, mrrPence (3-month avg); timeSeries by month; clientBreakdown via prisma.invoice.groupBy |

### Plan 05 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/portal/portal-sidebar.tsx` | Contains Billing nav item | VERIFIED | Receipt icon imported; `{ href: "/portal/billing", label: "Billing", icon: Receipt }` at line 40 |
| `src/app/(portal)/portal/billing/page.tsx` | Portal billing page | VERIFIED | 116 lines; queries prisma directly (no API round-trip); filters status NOT draft; Table with Invoice#, Date, Due Date, Amount, Status, PDF download link using viewToken |
| `src/app/api/portal/invoices/route.ts` | Portal invoice list API | VERIFIED | getPortalSession() → workspaceSlug; findMany where status NOT draft; 401 on session failure |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app/api/invoices/[id]/pdf/route.ts` | `src/lib/invoices/pdf.tsx` | renderToBuffer import | WIRED | `import { InvoicePdfDocument } from "@/lib/invoices/pdf"` + `renderToBuffer(React.createElement(InvoicePdfDocument, { invoice }) as any)` |
| `src/app/api/invoices/[id]/send/route.ts` | `src/lib/invoices/email.ts` | sendInvoiceEmail import | WIRED | `import { sendInvoiceEmail } from "@/lib/invoices/email"` + `await sendInvoiceEmail(invoice, recipientEmail)` |
| `src/app/api/invoices/route.ts` | `src/lib/invoices/operations.ts` | createInvoice, listInvoices | WIRED | `import { createInvoice, listInvoices } from "@/lib/invoices/operations"` + both called in handlers |
| `src/app/api/inbox-health/check/route.ts` | `src/lib/invoices/generator.ts` | generateDueInvoices import | WIRED | `import { generateDueInvoices, alertUnpaidBeforeRenewal } from "@/lib/invoices/generator"` + both called in GET handler |
| `src/app/api/inbox-health/check/route.ts` | `src/lib/invoices/overdue.ts` | markAndNotifyOverdueInvoices import | WIRED | `import { markAndNotifyOverdueInvoices } from "@/lib/invoices/overdue"` + called in GET handler |
| `src/lib/invoices/overdue.ts` | `src/lib/notifications.ts` | notify() + sendNotificationEmail | WIRED | `import { notify } from "@/lib/notify"` + `import { sendNotificationEmail } from "@/lib/resend"` — both called |
| `src/app/(admin)/financials/page.tsx` | `/api/invoices` | fetch in useEffect | WIRED | `fetch('/api/invoices?${params}')` inside fetchInvoices callback; wired to filterWorkspace/filterStatus state |
| `src/app/(admin)/revenue/page.tsx` | `/api/revenue` | fetch in useEffect | WIRED | `fetch('/api/revenue?months=12')` inside fetchRevenue; data set to typed RevenueResponse |
| `src/app/(portal)/portal/billing/page.tsx` | `prisma.invoice.findMany` | Direct server query | WIRED | Queries DB directly with workspaceSlug + status filter |
| `src/lib/invoices/overdue.ts` | `/portal/invoices/${viewToken}` | sendOverdueReminderEmail CTA | NOT_WIRED | URL `/portal/invoices/[token]` does not exist as a page; route 404s |

---

## Requirements Coverage

The phase references requirement IDs INV-01 through INV-12. These IDs are NOT defined in `.planning/REQUIREMENTS.md` (that file covers v2.0 DISC/SIG/PIPE/CFG/COPY/DASH/CLI requirements only). The INV- requirements were defined in ROADMAP.md and the individual PLAN frontmatter. Coverage is assessed against the 5 ROADMAP success criteria and plan must_haves instead.

| Req ID | Source Plans | Description (inferred from plan must_haves) | Status |
|--------|-------------|---------------------------------------------|--------|
| INV-01 | 22-01, 22-02, 22-04 | Invoice creation with line items, number generation, status lifecycle | SATISFIED |
| INV-02 | 22-02 | PDF generation matching branded format | SATISFIED |
| INV-03 | 22-02 | Email delivery via Resend with PDF attached | SATISFIED |
| INV-04 | 22-01, 22-02 | Invoice CRUD API routes | SATISFIED |
| INV-05 | 22-01, 22-02 | Status transition machine with validation | SATISFIED |
| INV-06 | 22-01 | Workspace billing fields (prefix, tax rate, renewal date, amounts) | SATISFIED |
| INV-07 | 22-03 | Auto-generation cron with 7-day look-ahead and idempotency | SATISFIED |
| INV-08 | 22-03 | Overdue detection and status update | SATISFIED |
| INV-09 | 22-03 | Reminder emails and 48h unpaid renewal alerts | PARTIAL — overdue reminder email CTA is a dead link |
| INV-10 | 22-05 | Portal billing tab with invoice history + PDF download | SATISFIED |
| INV-11 | 22-04 | Admin invoice management UI (list, create, send, mark paid) | SATISFIED |
| INV-12 | 22-04 | Revenue analytics dashboard (KPIs, chart, per-client table) | SATISFIED |

**Note:** INV-09 is PARTIAL. The overdue reminder email is sent (once, guarded by reminderSentAt), but the "View Invoice" CTA button in the email links to `/portal/invoices/${viewToken}` — a page that does not exist in the portal app. The portal billing page is `/portal/billing`. This means overdue clients receive a reminder email with a broken link.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/invoices/overdue.ts` | 17-20 | Dead URL in reminder email CTA (`/portal/invoices/${viewToken}`) | Warning | Overdue clients receive a functional email but the CTA leads to a 404; clients cannot navigate to the invoice from the reminder |

No TODO/FIXME placeholders, no stub implementations, no empty return values, no console.log-only handlers found in any phase 22 file.

---

## Commit Verification

All commits from SUMMARY files verified present in git log:

| Plan | Commit | Description |
|------|--------|-------------|
| 22-01 Task 1 | f4607a7 | Invoice models + Workspace billing fields to schema |
| 22-01 Task 2 | 8a930c6 | Invoice types, GBP utilities, numbering, CRUD operations |
| 22-02 Task 1 | ad2625f | Invoice CRUD API routes + invoice-settings endpoint |
| 22-02 Task 2 | 9463720 | PDF generation, email delivery, pdf/send API routes |
| 22-03 Task 1 | 3903ca4 | Invoice auto-generation and overdue detection |
| 22-03 Task 2 | c0aaee4 | Merge invoice checks into daily cron |
| 22-04 Task 1 | 771acf9 | Sidebar Financials group, invoice list page, invoice form, status badge |
| 22-04 Task 2 | 5886f36 | Revenue API, revenue chart, revenue dashboard page |
| 22-05 Task 1 | 832e073 | Portal billing tab with invoice history and PDF download |

---

## Human Verification Required

### 1. Invoice PDF Visual Quality

**Test:** Create a test invoice via POST /api/invoices with a workspace that has invoicePrefix and billingCompanyName configured, then GET /api/invoices/{id}/pdf
**Expected:** Returns A4 PDF with: "INVOICE" header (24pt bold), two-column sender/bill-to layout, metadata bar (Invoice #, Date, Due Date, Amount Due), line items table with description/qty/unit price/amount columns, right-aligned totals section with bold branded total row, bank details notes section at bottom
**Why human:** PDF visual layout cannot be verified by static code analysis; @react-pdf/renderer renders at runtime

### 2. Invoice Email Delivery

**Test:** Configure a workspace with billingClientEmail, create an invoice, then POST /api/invoices/{id}/send
**Expected:** Recipient receives branded HTML email with OUTSIGNAL header, invoice number heading, billing period text, amount/due date table, "View Invoice" CTA button, PDF attachment named {invoiceNumber}.pdf
**Why human:** Requires live Resend API + email client to verify delivery and rendering

### 3. Invoice Form Interactivity

**Test:** Navigate to /financials, click "New Invoice", select a workspace that has billingRetainerPence and billingPlatformFeePence configured
**Expected:** Line items pre-populate with "Cold Outbound Retainer" and "Cold Outbound Platform Fee" at the correct pound amounts; changing quantities/prices updates the subtotal/tax/total preview in real-time
**Why human:** Client-side React state behavior cannot be verified by file inspection

### 4. Revenue Dashboard With Live Data

**Test:** Mark an invoice as paid (PATCH /api/invoices/{id} with status: "paid"), then navigate to /revenue
**Expected:** Total Revenue KPI shows the paid amount in GBP; monthly chart shows a bar/point for the current month; per-client breakdown shows the workspace row with invoice count
**Why human:** Requires DB data + browser rendering to verify chart and KPI accuracy

---

## Gaps Summary

**1 gap found** — a broken URL in the overdue reminder email.

The overdue detection and notification system (`src/lib/invoices/overdue.ts`) correctly identifies sent invoices past their due date, marks them overdue, guards against duplicate reminder emails via `reminderSentAt`, and fires admin Slack alerts. However, the `sendOverdueReminderEmail()` function builds its "View Invoice" CTA URL as:

```typescript
const viewUrl = invoice.viewToken
  ? `${portalBase}/portal/invoices/${invoice.viewToken}`
  : `${portalBase}/portal/invoices`;
```

No page exists at `/portal/invoices` or `/portal/invoices/[token]` in the Next.js portal app. The portal billing page is at `/portal/billing`. The correct fix is one of:
- Change the URL to `${portalBase}/portal/billing` (sends client to their billing history)
- Change the URL to `${baseUrl}/api/invoices/${invoice.id}/pdf?token=${invoice.viewToken}` (direct PDF download, consistent with how `email.ts` handles the invoice send CTA)

This does not block all other phase functionality — it only affects overdue reminder emails, which is an automated notification path. All other invoice creation, PDF download, email sending, portal billing tab, and revenue dashboard functions are fully operational.

---

*Verified: 2026-03-04T23:45:00Z*
*Verifier: Claude (gsd-verifier)*
