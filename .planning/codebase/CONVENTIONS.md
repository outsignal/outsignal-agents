# Coding Conventions

**Analysis Date:** 2026-03-01

## Naming Patterns

**Files:**
- API routes: lowercase with dashes, colocated with `route.ts` (e.g., `src/app/api/people/enrich/route.ts`)
- Components: PascalCase (e.g., `MetricCard.tsx`, `Card.tsx`)
- Library/utility files: kebab-case or camelCase based on export style
  - Classes exported: camelCase (e.g., `emailbison/client.ts` exports `EmailBisonClient`)
  - Functions exported: camelCase basename (e.g., `notifications.ts`, `normalize.ts`)
- Test files: match source behavior + `.test.ts` suffix (e.g., `enrichment-dedup.test.ts` for `enrichment/dedup.ts`)

**Functions:**
- camelCase universally (e.g., `normalizeCompanyName`, `enrichPerson`, `postMessage`)
- Async functions: camelCase with no special prefix (e.g., `async function enrichPerson()`)
- Internal helper functions: prefix with underscore if truly private to module (rarely used)

**Variables:**
- camelCase for all variables, constants, parameters (e.g., `normalizedEmail`, `extraFields`, `mockProposals`)
- ALL_CAPS for module-level constants that are truly immutable (e.g., `KNOWN_FIELDS`, `FREE_EMAIL_DOMAINS`, `FIELD_ALIASES`)
- Avoid single-letter variables except in loops (`i`, `j`) or mathematical contexts

**Types:**
- PascalCase for all interfaces and type aliases (e.g., `EnrichmentPayload`, `MetricCardProps`, `AdminSession`)
- Generic parameters: single uppercase letter or PascalCase (e.g., `<T>`, `<Props>`)
- Field names in types/interfaces: camelCase (e.g., `interface CreateCampaignParams { maxEmailsPerDay: number }`)

**Naming Examples:**
```typescript
// ✅ Correct
interface EnrichmentPayload {
  email: string;
  firstName?: string;
  companyDomain?: string;
}

const FREE_EMAIL_DOMAINS = new Set([...]);
function normalizeCompanyName(name: string): string { ... }
export class EmailBisonClient { ... }

// ❌ Avoid
interface enrichment_payload { ... }
const free_email_domains = ...
function NormalizeCompanyName() { ... }
export class emailbison_client { ... }
```

## Code Style

**Formatting:**
- ESLint: `eslint` v9 with `eslint-config-next` (core-web-vitals + TypeScript)
- Prettier: Not explicitly configured; Next.js defaults (2-space indents)
- Line length: No enforced limit observed, pragmatic approach

**Linting:**
- Config: `eslint.config.mjs` (flat config format)
- Extends: `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Ignores: `.next/**`, `out/**`, `build/**`, `next-env.d.ts`
- Run with: `npm run lint`

**TypeScript:**
- `strict: true` (full type checking enabled)
- `noEmit: true` (type checking only, no emit)
- `lib: ["dom", "dom.iterable", "esnext"]`
- `target: ES2017`
- `module: esnext`, `moduleResolution: bundler`
- Path alias: `@/*` → `./src/*`

## Import Organization

**Order:**
1. External packages (React, Next.js, third-party libraries)
2. Type imports from external packages: `import type { ... } from "..."`
3. Internal lib imports: `import { ... } from "@/lib/..."`
4. Internal component imports: `import { ... } from "@/components/..."`
5. Type imports from local modules: `import type { ... } from "@/..."`

**Path Aliases:**
- Always use `@/` alias for internal imports, never relative paths
- Example: `import { prisma } from "@/lib/db"` (not `../../lib/db`)
- Enforced throughout codebase without exception

**Barrel Files:**
- Used sparingly; most lib modules export single class/function
- Example: `src/lib/emailbison/` exports `EmailBisonClient` and `types`

**Example Import Structure:**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeCompanyName } from "@/lib/normalize";
import type { Campaign } from "@/lib/emailbison/types";
```

## Error Handling

**Patterns:**
- Try-catch blocks around async operations (API calls, database queries, external integrations)
- HTTP routes return `NextResponse.json({ error: "message" }, { status: statusCode })`
- Custom error classes for specific error types (e.g., `EmailBisonApiError`, `RateLimitError`)
- Graceful degradation: non-critical operations catch errors and return early (e.g., Slack notifications, email sends)

**Custom Errors:**
```typescript
class EmailBisonApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Email Bison API error ${status}: ${body}`);
    this.name = "EmailBisonApiError";
  }
}

class RateLimitError extends EmailBisonApiError {
  constructor(public retryAfter: number) {
    super(429, `Rate limited. Retry after ${retryAfter}s`);
    this.name = "RateLimitError";
  }
}
```

**Logging on Error:**
- `console.error()` for unexpected failures (Slack/email notification failures, API errors)
- `console.warn()` for configuration issues (missing env vars, skipped features)
- Error messages include context: `"Slack notification failed:", err` (not just `err`)

**API Route Pattern:**
```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    // validation & processing
    return NextResponse.json(result);
  } catch (error) {
    console.error("Enrichment error:", error);
    return NextResponse.json(
      { error: "Failed to enrich person" },
      { status: 500 }
    );
  }
}
```

**Non-Critical Failures (Notifications):**
```typescript
if (workspace.slackChannelId) {
  try {
    await postMessage(...);
  } catch (err) {
    console.error("Slack notification failed:", err);
    // Continue execution, don't re-throw
  }
}
```

## Logging

**Framework:** `console` (no structured logging library)

**Patterns:**
- `console.error()`: Unexpected/critical failures (API errors, unhandled exceptions)
- `console.warn()`: Missing configuration, skipped features (env var not set)
- `console.log()`: Rarely used in production code, mostly for debugging
- Messages include context prefix for grep-ability: `"Slack notification failed:"`, `"Enrichment error:"`

**Best Practice:**
```typescript
// ✅ Good
console.error("Slack notification failed:", err);
console.warn("SLACK_BOT_TOKEN not set, skipping channel creation");

// ❌ Avoid
console.error(err);
console.log("things");
```

## Comments

**When to Comment:**
- Complex algorithms or business logic (e.g., enrichment field merging, company name normalization)
- Non-obvious parameter names or return behavior
- Workarounds for external API quirks (e.g., "name param is IGNORED by API")
- Links to related code or documentation
- Rarely used: comment-per-line not encouraged, prefer clear naming

**JSDoc/TSDoc:**
- Minimal usage; types handle most documentation
- Used on exported functions with complex signatures
- Example in codebase: `src/lib/normalize.ts` has JSDoc on main export

**Example:**
```typescript
/**
 * Normalize a company name to consistent title case, with special handling
 * for acronyms, domain suffixes, and hyphenated names.
 */
export function normalizeCompanyName(name: string): string {
  // If 4 chars or fewer and all uppercase, keep as-is (acronyms like DHL, VGS, RTA)
  if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase()) {
    return trimmed;
  }

  // Note: name param is IGNORED by API — always produces "Copy of {original}"
  async duplicateCampaign(templateCampaignId: number): Promise<CampaignCreateResult> {
    // ...
  }
}
```

## Function Design

**Size:**
- Typically 20-80 lines for utility/service functions
- API routes 50-100 lines including validation and business logic
- Larger functions acceptable for sequential, single-purpose workflows

**Parameters:**
- Use object destructuring for multiple params: `function enrichPerson(payload: EnrichmentPayload)`
- Optional fields marked with `?` in interface: `firstName?: string`
- No required parameters after optional ones

**Return Values:**
- Type-annotated explicitly: `Promise<T>`, `string | null`, `{ created: boolean; updated: boolean }`
- Consistent return shape (e.g., enrichment returns `{ created, updated, error? }`)
- Early returns to reduce nesting

**Example Function:**
```typescript
async function enrichPerson(
  payload: EnrichmentPayload,
): Promise<{ created: boolean; updated: boolean; error?: string }> {
  const { email } = payload;

  if (!email || typeof email !== "string") {
    return { created: false, updated: false, error: "email is required" };
  }

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await prisma.person.findUnique({
    where: { email: normalizedEmail },
  });

  if (!existing) {
    // Create flow...
    return { created: true, updated: false };
  }

  // Update flow...
  const updateData: Record<string, unknown> = {};
  if (payload.linkedinUrl) updateData.linkedinUrl = payload.linkedinUrl;

  if (Object.keys(updateData).length > 0) {
    await prisma.person.update({
      where: { id: existing.id },
      data: updateData,
    });
  }

  return { created: false, updated: Object.keys(updateData).length > 0 };
}
```

## Module Design

**Exports:**
- Mix of named and class exports (not default exports)
- Class exports: `export class EmailBisonClient { ... }`
- Function exports: `export async function notifyReply(...) { ... }`
- Type exports: `export interface EnrichmentPayload { ... }`

**Barrel Files:**
- Not heavily used; most modules are single-file
- When used, re-export from main module (e.g., `src/lib/emailbison/` includes client and types)

**File Organization:**
- Interfaces/types at top of file
- Classes after types
- Helper functions after main exports
- Private functions inline or bottom of file

**Example (client.ts):**
```typescript
// 1. Types
import type { Campaign, Lead, Reply } from "./types";

// 2. Custom errors
class EmailBisonApiError extends Error { ... }
class RateLimitError extends EmailBisonApiError { ... }

// 3. Main class
export class EmailBisonClient {
  private baseUrl = "https://app.outsignal.ai/api";
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(...) { ... }
  private async getAllPages<T>(...) { ... }

  async getCampaigns(): Promise<Campaign[]> { ... }
  async getReplies(): Promise<Reply[]> { ... }
}
```

---

*Convention analysis: 2026-03-01*
