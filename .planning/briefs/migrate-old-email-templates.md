# PROJECT BRIEF: Migrate 8 Email Notifications to Shared Template

## Objective

Migrate 8 email notifications from the old `buildEmailHtml()` template system to the shared `emailLayout()` template system in `src/lib/email-template.ts`. This ensures consistent Outsignal branding across all emails.

## Context

The shared template system (`src/lib/email-template.ts`) provides branded email helpers with:
- Outsignal logo header
- `#635BFF` purple accent line
- Geist Sans font stack
- `#F8F7F5` warm stone background
- White card body
- Consistent spacing and typography

8 notifications still use old local `buildEmailHtml()` functions with Arial fonts, dark backgrounds, and inconsistent styling. Each file has its own copy of `buildEmailHtml()`.

## Notifications to Migrate

### File 1: `src/lib/domain-health/notifications.ts`

**4 notifications + 1 old helper to remove:**

1. **`notifyBlacklistHit`** (~line 40) — type: `domain_blacklisted`
   - Per-domain alert when listed on a DNSBL
   - Content: domain name, list of DNSBLs with delist URLs, severity
   - Migrate the email HTML (lines ~123-157) to use shared helpers

2. **`notifyDnsFailure`** (~line 230) — type: `domain_dns_failure`
   - Per-domain alert when SPF/DKIM/DMARC/MX fails
   - Content: domain name, failed checks with status, persistent badge if >48h, escalation warning
   - Migrate the email HTML (lines ~324-359) to use shared helpers

3. **`sendBlacklistDigestEmail`** (~line 380) — type: `domain_blacklisted_digest`
   - Batched digest of all blacklist hits across domains
   - Content: domain count, total hits, per-domain rows with DNSBL names and delist links
   - Migrate the email HTML (lines ~436-454) to use shared helpers

4. **`sendDnsFailureDigestEmail`** (~line 459) — type: `domain_dns_failure_digest`
   - Batched digest of all DNS failures across domains
   - Content: domain count, per-domain sections with failed checks, persistent badges, escalation warning
   - Migrate the email HTML (lines ~526-548) to use shared helpers

5. **Remove `buildEmailHtml()`** (~line 554) — old helper function, no longer needed after migration

### File 2: `src/lib/domain-health/bounce-notifications.ts`

**2 notifications + 2 old helpers to remove:**

1. **`notifySenderHealthTransition`** (~line 401) — type: `sender_health_{status}`
   - Per-sender alert when bounce health changes (escalation or recovery)
   - Content: sender email, workspace, old/new status, bounce rate, reason, action taken, replacement sender suggestion
   - Migrate the email HTML (lines ~455-484) to use shared helpers

2. **`sendSenderHealthDigestEmail`** (~line 494) — type: `sender_health_digest`
   - Batched digest of all sender health transitions from one bounce monitor run
   - Content: transition count, table of senders with columns: sender, workspace, was, now, bounce %, reason, action
   - Migrate the email HTML (lines ~614-631) to use shared helpers

3. **Remove `buildEmailHtml()`** (~line 167) and **`buildEmailWrapper()`** (~line 257) — old helper functions

### File 3: `src/lib/placement/notifications.ts`

**1 notification + 1 old helper to remove:**

1. **`notifyPlacementResult`** (~line 58) — type: `placement_test_result`
   - Alert when inbox placement test completes with warning or critical score
   - Content: score card (large number with color), provider results table, recommended action box
   - Migrate the email HTML (lines ~138-220) to use shared helpers

2. **Remove `buildEmailHtml()`** (~line 226) — old helper function

### File 4: `src/app/api/stripe/webhook/route.ts`

**1 notification:**

1. **Payment onboarding email** (~line 56-112) — type: `payment_onboarding`
   - Sent when Stripe payment completes, welcoming client
   - Content: welcome message, next steps, onboarding link
   - Migrate inline HTML to use `emailLayout()`, `emailHeading()`, `emailButton()`, `emailText()`

## Shared Template Helpers Available

From `src/lib/email-template.ts`:

```typescript
emailLayout({ body, footerNote })     // Full HTML wrapper with logo, purple accent, white card
emailHeading(title, subtitle?)         // Large heading + subtitle
emailButton(label, href)              // Purple CTA button (#635BFF)
emailStatBox(value, label, color, bgColor)  // Large number stat card
emailStatRow(left, right)             // Two-column stat layout
emailStatRow3(col1, col2, col3)       // Three-column stat layout
emailLabel(text)                      // Uppercase muted section label
emailText(text)                       // Body paragraph
emailBanner(text, { color, bgColor, borderColor })  // Alert box
emailPill(label, color, bgColor)      // Status pill
emailNotice(text)                     // Muted info box
emailDivider()                        // Horizontal rule
emailDetailCard(rows)                 // Key-value detail rows
emailCallout(text)                    // Accent-bordered callout
```

## Migration Pattern

For each notification, follow this pattern:

**Before (old):**
```typescript
const html = buildEmailHtml({
  title: "DNS Warning: 1 Domain Failing",
  bodyContent: `<p style="font-family:Arial,...">...</p>
    <table>...</table>`,
});
```

**After (new):**
```typescript
const body = [
  emailHeading("DNS Warning", "1 domain failing"),
  emailText("DNS validation failed for the following domain:"),
  emailLabel("limerecuk.co.uk"),
  emailPill("DKIM: missing", "#dc2626", "#fee2e2"),
  emailDivider(),
  emailNotice("DNS changes may take up to 24 hours to propagate."),
  emailButton("View Deliverability Dashboard", dashboardUrl),
].join("");

const html = emailLayout({
  body,
  footerNote: "Domain health alert. You received this as the system administrator.",
});
```

Key principles:
- Replace raw `<p>` tags with `emailText()`
- Replace raw `<table>` headers with `emailLabel()`
- Replace inline status badges with `emailPill()`
- Replace raw tables with `emailDetailCard()` where it fits, or keep minimal inline HTML for complex tables (but use Geist Sans font stack, not Arial)
- Use `emailBanner()` for critical/escalation warnings
- Use `emailStatBox()` + `emailStatRow()` for key metrics
- Use `emailButton()` for CTAs
- Wrap everything in `emailLayout()`

## Important Notes

- **Do not change notification logic** — only change the HTML output
- **Do not change what data is included** — keep the same information, just restyle it
- **Do not change Slack notifications** — only email templates
- **Do not change audit logging** — keep the same `audited()` wrapper and notification types
- **Keep the same subject lines** — or improve them slightly if they're inconsistent
- **Import shared helpers** at the top of each file:
  ```typescript
  import { emailLayout, emailHeading, emailButton, emailText, emailLabel, emailPill, emailBanner, emailDivider, emailStatBox, emailStatRow, emailNotice, emailDetailCard, emailCallout } from "@/lib/email-template";
  ```
- **Remove old `buildEmailHtml` / `buildEmailWrapper` functions** after migration — they should have zero remaining callers

## Acceptance Criteria

1. All 8 notifications use `emailLayout()` from `src/lib/email-template.ts`
2. All old `buildEmailHtml()` / `buildEmailWrapper()` functions removed (3 files)
3. Emails render with Outsignal branding: logo, `#635BFF` purple accent, Geist Sans fonts, warm stone background
4. Same information content in each email — nothing added or removed
5. Notification types, audit logging, and Slack notifications unchanged
6. Build passes (`npm run build`)

## Files to Change

| File | Changes |
|------|---------|
| `src/lib/domain-health/notifications.ts` | Migrate 4 emails, remove `buildEmailHtml()` |
| `src/lib/domain-health/bounce-notifications.ts` | Migrate 2 emails, remove `buildEmailHtml()` + `buildEmailWrapper()` |
| `src/lib/placement/notifications.ts` | Migrate 1 email, remove `buildEmailHtml()` |
| `src/app/api/stripe/webhook/route.ts` | Migrate 1 email |

## Files NOT to Change

| File | Reason |
|------|--------|
| `src/lib/email-template.ts` | Shared helpers already sufficient |
| `src/lib/notifications.ts` | Already on new template |
| `prisma/schema.prisma` | No schema changes |
| Any trigger files | No changes to scheduling |
| Any UI components | Email-only changes |
