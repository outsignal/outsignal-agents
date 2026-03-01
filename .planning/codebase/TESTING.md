# Testing Patterns

**Analysis Date:** 2026-03-01

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts`
- Environment: Node.js (not jsdom)
- Globals: enabled (`globals: true`)

**Assertion Library:**
- Vitest's built-in `expect` (from Vitest)
- Also installed: `@testing-library/jest-dom` (6.9.1) for additional matchers
- Additional packages: `@testing-library/react` (16.3.2) for React testing

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Watch mode for development
vitest --coverage        # Run with coverage report
```

**Vitest Config:**
- `src/__tests__/setup.ts` as global setup file
- Node environment
- Path alias `@/` resolves to `src/`

## Test File Organization

**Location:**
- Centralized in `src/__tests__/` directory
- NOT colocated with source files
- Setup file: `src/__tests__/setup.ts` (initialized by vitest.config.ts)

**Naming:**
- Pattern: `{module}.test.ts`
- Examples: `slack.test.ts`, `emailbison-client.test.ts`, `api-routes.test.ts`, `enrichment-dedup.test.ts`

**Current Test Files (12 total, 3,369 lines):**
```
src/__tests__/
├── setup.ts                          # Global Prisma mock setup (96 lines)
├── api-routes.test.ts                # Proposal/webhook routes (444 lines)
├── emailbison-client.test.ts          # EmailBison API client (461 lines)
├── enrichment-dedup.test.ts           # Deduplication logic (105 lines)
├── enrichment-queue.test.ts           # Job queuing system (340 lines)
├── lib-utils.test.ts                  # Utility functions (295 lines)
├── linkedin-queue.test.ts             # LinkedIn queue processing (290 lines)
├── linkedin-rate-limiter.test.ts      # Rate limiting (238 lines)
├── linkedin-sender.test.ts            # LinkedIn sending (211 lines)
├── normalizer.test.ts                 # Company name normalization (192 lines)
├── resend-notifications.test.ts       # Email notifications (331 lines)
└── slack.test.ts                      # Slack integration (462 lines)
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";

describe("Module/Feature Name", () => {
  beforeEach(() => {
    vi.clearAllMocks();  // Clear all mocks before each test
  });

  afterEach(() => {
    vi.restoreAllMocks();  // Restore all mocks after each test
  });

  describe("Function Name", () => {
    it("should do specific behavior when X", async () => {
      // Arrange
      (prisma.person.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "p-1",
        email: "test@example.com",
      });

      // Act
      const result = await functionUnderTest("param");

      // Assert
      expect(result).toEqual(expectedValue);
      expect(prisma.person.findUnique).toHaveBeenCalledWith({
        where: { email: "test@example.com" },
      });
    });

    it("should throw when X is missing", async () => {
      await expect(functionUnderTest("invalid")).rejects.toThrow("error message");
    });
  });
});
```

**Patterns:**
- `describe` blocks organize by feature/function
- Nested `describe` blocks for sub-features
- `beforeEach` clears mocks before each test
- `afterEach` cleans up (optional, but used for environment variables)
- Test names use "should" style: "returns campaigns from paginated response"
- Import style: `import { describe, it, expect, vi, beforeEach } from "vitest"`

## Mocking

**Framework:** Vitest `vi.mock()` and `vi.fn()`

**Module Mocking:**

### Setup File Mocks (setup.ts)
Global Prisma mock set up once for all tests:
```typescript
import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    person: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    enrichmentJob: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // ... other models
  },
}));
```

### Per-Test Module Mocks
Example from `slack.test.ts`:
```typescript
const mockConversationsCreate = vi.fn();
const mockUsersLookupByEmail = vi.fn();
const mockChatPostMessage = vi.fn();

vi.mock("@slack/web-api", () => {
  const MockWebClient = vi.fn(function () {
    return {
      conversations: { create: mockConversationsCreate },
      users: { lookupByEmail: mockUsersLookupByEmail },
      chat: { postMessage: mockChatPostMessage },
    };
  });
  return { WebClient: MockWebClient };
});

// Import AFTER mocking so the mock is in place
import { createPrivateChannel } from "@/lib/slack";
```

### Hoisted Mocks for Factory Functions
Example from `resend-notifications.test.ts`:
```typescript
const { mockSend, mockPostMessage } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ id: "test-email-id" }),
  mockPostMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

// Now imports work because hoisted mocks run before module setup
```

### Mock Setup Pattern
```typescript
beforeEach(() => {
  vi.clearAllMocks();  // Clear call history
  (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);
});
```

**What to Mock:**
- External API clients (Slack WebClient, Resend, EmailBison)
- Database client (Prisma)
- Next.js modules (NextResponse, NextRequest)
- Environment-dependent services

**What NOT to Mock:**
- Pure utility functions (e.g., `normalizeCompanyName`)
- Error classes
- Type definitions
- Internal helper functions

## Fixtures and Factories

**Test Data Helpers:**
Example from `emailbison-client.test.ts`:
```typescript
function makePaginatedResponse<T>(
  data: T[],
  currentPage: number,
  lastPage: number,
): PaginatedResponse<T> {
  return {
    data,
    links: {
      first: `${BASE_URL}?page=1`,
      last: `${BASE_URL}?page=${lastPage}`,
      prev: currentPage > 1 ? `${BASE_URL}?page=${currentPage - 1}` : null,
      next: currentPage < lastPage ? `${BASE_URL}?page=${currentPage + 1}` : null,
    },
    meta: {
      current_page: currentPage,
      from: (currentPage - 1) * data.length + 1,
      last_page: lastPage,
      per_page: 15,
      to: currentPage * data.length,
      total: lastPage * data.length,
    },
  };
}

function mockFetchResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["retry-after", "60"]]),
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response;
}
```

**Location:**
- Defined within test files as helper functions
- No separate fixtures directory
- Constants like `BASE_URL` and `TEST_TOKEN` at top of test file

## Coverage

**Requirements:** Not enforced (no coverage configuration)

**View Coverage:**
```bash
vitest --coverage
```

## Test Types

**Unit Tests (Primary):**
- Individual function behavior in isolation
- Mocked dependencies
- Fast execution (~1-5ms per test)
- Examples: `normalizer.test.ts` (192 lines), `enrichment-dedup.test.ts` (105 lines)

**Integration Tests (Secondary):**
- Testing interaction between mocked modules
- API route handlers with mocked Prisma and external services
- Examples: `api-routes.test.ts` (444 lines), `resend-notifications.test.ts` (331 lines)

**E2E Tests:**
- Not present in this codebase

## Common Patterns

**Async Testing with await/rejects:**
```typescript
it("returns campaigns from paginated response", async () => {
  const mockJob = {
    id: "job-1",
    entityType: "person",
    provider: "prospeo",
    status: "pending",
    entityIds: JSON.stringify(["p1", "p2"]),
  };
  (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(mockJob);

  const result = await processNextChunk();

  expect(result).toEqual(expect.objectContaining({
    jobId: "job-1",
    processed: 2,
  }));
});

// Error cases
await expect(enqueueJob({ entityIds: [] })).rejects.toThrow(
  "Cannot enqueue job with empty entityIds"
);
```

**Error Testing:**
```typescript
it("throws EmailBisonApiError on 500 response", async () => {
  fetchMock.mockResolvedValueOnce(
    mockFetchResponse("Internal Server Error", 500),
  );

  await expect(client.getCampaigns()).rejects.toThrow(
    /Email Bison API error 500/
  );

  // Verify error properties
  try {
    await client.getCampaigns();
  } catch (error: unknown) {
    expect((error as any).name).toBe("EmailBisonApiError");
    expect((error as any).status).toBe(500);
  }
});
```

**Environment Variable Testing:**
```typescript
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

it("returns null when SLACK_BOT_TOKEN is not set", async () => {
  delete process.env.SLACK_BOT_TOKEN;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const result = await createPrivateChannel("test-channel");

  expect(result).toBeNull();
  expect(warnSpy).toHaveBeenCalledWith(
    "SLACK_BOT_TOKEN not set, skipping channel creation"
  );
  warnSpy.mockRestore();
});
```

**Mock Verification with Multiple Calls:**
```typescript
it("processes a chunk and transitions to complete", async () => {
  (prisma.enrichmentJob.findFirst as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(mockJob)
    .mockResolvedValueOnce(null);  // Second call returns nothing
  (prisma.enrichmentJob.update as ReturnType<typeof vi.fn>).mockResolvedValue({});

  const result = await processNextChunk();

  expect(result).toEqual({
    jobId: "job-1",
    processed: 2,
    done: true,
    status: "complete",
  });

  // Verify multiple updates
  expect(prisma.enrichmentJob.update).toHaveBeenCalledTimes(2);
  expect(prisma.enrichmentJob.update).toHaveBeenNthCalledWith(1, {
    where: { id: "job-1" },
    data: { status: "running" },
  });
  expect(prisma.enrichmentJob.update).toHaveBeenNthCalledWith(2, {
    where: { id: "job-1" },
    data: expect.objectContaining({ status: "complete" }),
  });
});
```

**API Route Testing:**
```typescript
describe("POST /api/proposals", () => {
  let POST: typeof import("@/app/api/proposals/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST } = await import("@/app/api/proposals/route"));
  });

  it("returns 400 when clientName is missing", async () => {
    const req = postRequest({
      companyOverview: "Overview",
      packageType: "email",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/clientName/);
  });

  it("creates proposal and returns 200", async () => {
    (prisma.proposal.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "prop-1",
      clientName: "Acme Corp",
    });

    const req = postRequest({
      clientName: "Acme Corp",
      companyOverview: "Overview",
      packageType: "email",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("prop-1");
  });
});

function postRequest(data: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}
```

**Console Spying:**
```typescript
it("logs warning when RESEND_API_KEY is not set", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  await sendNotificationEmail({
    to: ["user@example.com"],
    subject: "Test",
    html: "<p>Hello</p>",
  });

  expect(warnSpy).toHaveBeenCalledWith(
    "RESEND_API_KEY not set, skipping email notification"
  );
  warnSpy.mockRestore();
});
```

## Global Setup

**File:** `src/__tests__/setup.ts` (96 lines)

**Purpose:** Initialize global Prisma mock before any tests run (prevents repeated mock definitions)

**Key Mocks:**
```typescript
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findMany, findUnique, create },
    proposal: { findMany, findUnique, create, update, updateMany },
    person: { findUnique, findMany, updateMany, count },
    enrichmentJob: { findFirst, create, update, findMany },
    enrichmentLog: { findFirst, create, findMany, count },
    linkedInAction: { create, findMany, findUnique, findUniqueOrThrow, update, updateMany },
    linkedInDailyUsage: { findUnique, create, upsert },
    linkedInConnection: { findFirst, findUnique, create, upsert, count },
    // ... 15+ models total
  },
}));
```

All test files rely on this setup, so Prisma mocking is consistent across tests.

---

*Testing analysis: 2026-03-01*
