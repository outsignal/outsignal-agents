# Coding Conventions

**Analysis Date:** 2026-02-26

## Naming Patterns

**Files:**
- Lowercase kebab-case with `.ts` or `.tsx` extension (e.g., `slack.ts`, `emailbison-client.ts`, `onboarding-invites.ts`)
- API route files: `route.ts` in directory structure reflecting endpoint path
- Component files: PascalCase for components but kebab-case filenames (e.g., `onboarding-steps.ts`)
- Test files: `{module}.test.ts` colocated in `src/__tests__/` directory

**Functions:**
- camelCase for all functions (e.g., `createPrivateChannel`, `lookupUserByEmail`, `slugify`, `getSlackClient`)
- Private helper functions: same camelCase (e.g., `getSlackClient()` in `slack.ts`)
- Exported functions are descriptive about their side effects or return values (e.g., `sendNotificationEmail`, `notifyReply`)

**Variables:**
- camelCase for variables, constants, and parameters
- Descriptive names reflecting purpose (e.g., `leadEmail`, `workspaceSlug`, `channelEmails`)
- Array/collection names sometimes plural (e.g., `recipients`, `allData`, `userIds`)
- Boolean variables with action verbs: `isPrivate`, `automatedReply`, `shouldCreateWorkspace`

**Types:**
- PascalCase for types and interfaces (e.g., `EmailBisonApiError`, `RateLimitError`, `AgentConfig`)
- Type files suffix with `.types.ts` when separate (e.g., `src/lib/emailbison/types.ts`)
- Import types use `type` keyword: `import type { PaginatedResponse, Campaign } from "./types"`

**Classes:**
- PascalCase (e.g., `EmailBisonClient`, `RateLimitError`, `EmailBisonApiError`)
- Private fields use `private` keyword explicitly

## Code Style

**Formatting:**
- ESLint configured via `eslint.config.mjs` using Next.js recommended config
- Enforces Next.js core-web-vitals and TypeScript rules
- No Prettier config detected; ESLint handles linting only

**Linting:**
- Next.js ESLint config: `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- Run: `npm run lint`
- Config file: `eslint.config.mjs`

## Import Organization

**Order:**
1. External packages (`next/*`, `@slack/web-api`, `resend`, `ai`, etc.)
2. Internal absolute imports using `@/` alias
3. Relative imports for same-directory utilities (rare)

**Path Aliases:**
- `@/*` → `./src/*` configured in `tsconfig.json`
- All imports use absolute `@/` paths, never relative

**Pattern Examples:**
```typescript
// External first
import { NextRequest, NextResponse } from "next/server";
import { WebClient, type KnownBlock } from "@slack/web-api";

// Internal second
import { prisma } from "@/lib/db";
import { postMessage } from "@/lib/slack";
import { notifyReply } from "@/lib/notifications";

// Types last
import type { AgentConfig, ToolCallStep } from "./types";
```

## Error Handling

**Patterns:**
- Custom error classes extend `Error` and set `this.name` for error type identification
- Type-specific error classes with properties (e.g., `EmailBisonApiError` has `status` and `body`)
- Errors thrown for missing required data (e.g., "Failed to create Slack channel")
- Functions return null instead of throwing for graceful missing config (e.g., `getSlackClient()` returns null if token missing)

**Examples:**
```typescript
// Custom error with properties
class EmailBisonApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`Email Bison API error ${status}: ${body}`);
    this.name = "EmailBisonApiError";
  }
}

// Graceful fallback for missing config
function getSlackClient(): WebClient | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;
  return new WebClient(token);
}

// Function returning null instead of throwing
export async function lookupUserByEmail(email: string): Promise<string | null> {
  const slack = getSlackClient();
  if (!slack) return null;
  // ...
}
```

## Logging

**Framework:** `console` module (console.log, console.warn, console.error)

**Patterns:**
- `console.warn()` for configuration issues (e.g., "SLACK_BOT_TOKEN not set, skipping...")
- `console.error()` for unexpected errors with context prefix (e.g., "Slack notification failed:", err)
- No structured logging framework; plain string messages
- Error logs include error object as second parameter for stack traces

**Examples:**
```typescript
// Configuration warning
console.warn("SLACK_BOT_TOKEN not set, skipping channel creation");

// Error with context
console.error("Slack notification failed:", err);
console.error("Webhook processing error:", error);
console.error("Failed to create Slack channel:", err);
```

## Comments

**When to Comment:**
- Function documentation: JSDoc comments for exported functions describing parameters and return values
- Complex logic: Inline comments explaining regex patterns or multi-step operations
- Configuration notes: Comments on why a particular approach is taken

**JSDoc/TSDoc:**
- Used for exported functions describing parameters and return type
- Example from `slack.ts`:
```typescript
/**
 * Look up a Slack user ID by email address.
 * Returns null if the user is not found in the workspace.
 * Requires the `users:read.email` bot scope.
 */
export async function lookupUserByEmail(
  email: string,
): Promise<string | null> {
```

## Function Design

**Size:**
- Most functions are 15-50 lines
- API route handlers 30-80 lines (including setup and error handling)
- Helper functions kept small and focused

**Parameters:**
- Use object parameters for multiple related arguments (e.g., `params: { workspaceSlug, leadEmail, subject }`)
- Single parameter used for simple cases
- Default parameters for optional config (e.g., `revalidate = 300` in fetch options)

**Return Values:**
- Promise-based for async operations (always used with `async/await`)
- Explicit null returns for "not found" cases instead of throwing
- Status codes and error objects in API responses via `NextResponse.json()`

**Example Parameter Style:**
```typescript
// Object parameters for related data
export async function notifyReply(params: {
  workspaceSlug: string;
  leadName?: string | null;
  leadEmail: string;
  senderEmail: string;
  subject: string | null;
  bodyPreview: string | null;
  interested?: boolean;
}): Promise<void>
```

## Module Design

**Exports:**
- Named exports for functions (e.g., `export async function createPrivateChannel()`)
- Classes exported as named exports
- Types exported separately with `export type`

**Barrel Files:**
- Not used; imports are direct from source files

**Directory Structure for Modules:**
- `src/lib/{feature}/` contains related functionality
- `src/lib/{feature}/client.ts` for client/API implementations
- `src/lib/{feature}/types.ts` for TypeScript type definitions
- Single responsibility: each file handles one concern

**Examples:**
```
src/lib/
├── slack.ts              # Slack API functions
├── resend.ts             # Email sending
├── notifications.ts      # Notification orchestration
├── emailbison/
│   ├── client.ts         # EmailBison API client class
│   ├── types.ts          # Type definitions
│   └── sync.ts           # Data sync logic
└── agents/
    ├── runner.ts         # Core agent execution
    ├── research.ts       # Research agent implementation
    └── types.ts          # Agent type definitions
```

---

*Convention analysis: 2026-02-26*
