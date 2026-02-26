# Testing Patterns

**Analysis Date:** 2026-02-26

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts`
- Environment: Node.js (no jsdom)

**Assertion Library:**
- Vitest's built-in expect (from Vitest)
- Also installed: `@testing-library/jest-dom` (6.9.1)

**Run Commands:**
```bash
npm run test              # Run all tests once
npm run test:watch       # Watch mode for development
npm test -- --coverage   # Run with coverage (vitest --coverage)
```

## Test File Organization

**Location:**
- Centralized in `src/__tests__/` directory
- Not colocated with source files
- Setup file: `src/__tests__/setup.ts`

**Naming:**
- Pattern: `{module}.test.ts`
- Examples: `slack.test.ts`, `emailbison-client.test.ts`, `api-routes.test.ts`

**Structure:**
```
src/__tests__/
├── setup.ts                      # Global test setup with Prisma mocks
├── slack.test.ts                 # Slack integration tests
├── emailbison-client.test.ts     # EmailBison client tests
├── resend-notifications.test.ts  # Email notification tests
├── api-routes.test.ts            # API route handler tests
└── lib-utils.test.ts             # Utility function tests
```

## Test Structure

**Suite Organization:**
```typescript
describe("Module/Feature Name", () => {
  let client: EmailBisonClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    client = new EmailBisonClient(TEST_TOKEN);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Function Name", () => {
    it("does specific behavior", async () => {
      // Arrange
      mockFn.mockResolvedValue(expectedValue);

      // Act
      const result = await functionUnderTest();

      // Assert
      expect(result).toBe(expectedValue);
      expect(mockFn).toHaveBeenCalledWith(expectedParams);
    });
  });
});
```

**Patterns:**
- `describe` blocks organize by feature/function
- Nested `describe` blocks for sub-features
- `beforeEach` clears mocks and sets up test state
- `afterEach` restores mocks and cleans up environment
- Test names use "should" style: "returns null when X is missing"

## Mocking

**Framework:** Vitest `vi.mock()` and `vi.fn()`

**Patterns:**

### Mock Modules Before Import
```typescript
// Mock setup BEFORE imports
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: { findMany: vi.fn() },
    proposal: { findMany: vi.fn() },
  },
}));

// Import after mocking
import { prisma } from "@/lib/db";
```

### Mock Classes
```typescript
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
```

### Hoisted Mocks for Factory Functions
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
```

### Mock Error Responses
```typescript
mockUsersLookupByEmail.mockRejectedValue({
  data: { error: "users_not_found" },
});

// With specific error structure
const otherError = new Error("network_failure");
(otherError as unknown as { data: { error: string } }).data = {
  error: "network_failure",
};
mockUsersLookupByEmail.mockRejectedValue(otherError);
```

**What to Mock:**
- External API clients (Slack, Resend, EmailBison)
- Database client (Prisma)
- Next.js modules (NextResponse, NextRequest)
- Environment-dependent services

**What NOT to Mock:**
- Pure utility functions
- Error classes
- Type definitions
- Internal helper functions (unless testing in isolation)

## Fixtures and Factories

**Test Data:**
- Helper functions for generating test data
- Example: `makePaginatedResponse()` in emailbison-client.test.ts
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
```

**Location:**
- Defined within test files as helper functions
- No separate fixture directory

## Coverage

**Requirements:** Not enforced (no coverage configuration in package.json or vitest.config.ts)

**View Coverage:**
```bash
vitest --coverage
```

## Test Types

**Unit Tests:**
- Primary testing approach
- Individual function behavior tested in isolation
- Mocked dependencies
- Fast execution (~1-2ms per test)
- Examples: `slack.test.ts`, `emailbison-client.test.ts`

**Integration Tests:**
- Testing interaction between mocked modules
- API route handlers with Prisma and external service mocks
- Examples: `api-routes.test.ts`, `resend-notifications.test.ts`

**E2E Tests:**
- Not used in this codebase
- No Playwright, Cypress, or similar configuration

## Common Patterns

**Async Testing:**
```typescript
it("returns campaigns from a single-page response", async () => {
  fetchMock.mockResolvedValueOnce(
    mockFetchResponse(makePaginatedResponse(campaigns, 1, 1)),
  );

  const result = await client.getCampaigns();

  expect(result).toEqual(campaigns);
});

// Using rejects for error cases
await expect(client.getCampaigns()).rejects.toThrow(/Rate limited/);
```

**Error Testing:**
```typescript
it("throws EmailBisonApiError on 500 response", async () => {
  fetchMock.mockResolvedValueOnce(
    mockFetchResponse("Internal Server Error", 500),
  );

  await expect(client.getCampaigns()).rejects.toThrow(
    /Email Bison API error 500/,
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
  process.env = { ...ORIGINAL_ENV };
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

it("returns null when SLACK_BOT_TOKEN is not set", async () => {
  delete process.env.SLACK_BOT_TOKEN;

  const result = await createPrivateChannel("test-channel");

  expect(result).toBeNull();
});
```

**Console Spying:**
```typescript
it("logs warning when API key not set", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  await sendNotificationEmail({
    to: ["user@example.com"],
    subject: "Test",
    html: "<p>Hello</p>",
  });

  expect(warnSpy).toHaveBeenCalledWith(
    "RESEND_API_KEY not set, skipping email notification",
  );

  warnSpy.mockRestore();
});
```

**Mock Verification with Multiple Calls:**
```typescript
it("aggregates data across multiple pages", async () => {
  const page1 = [{ id: 1, name: "Campaign A" }];
  const page2 = [{ id: 2, name: "Campaign B" }];

  fetchMock
    .mockResolvedValueOnce(
      mockFetchResponse(makePaginatedResponse(page1, 1, 2)),
    )
    .mockResolvedValueOnce(
      mockFetchResponse(makePaginatedResponse(page2, 2, 2)),
    );

  const result = await client.getCampaigns();

  expect(result).toEqual([...page1, ...page2]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/campaigns?page=1`);
  expect(fetchMock.mock.calls[1][0]).toBe(`${BASE_URL}/campaigns?page=2`);
});
```

**Parameterized API Routes:**
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
});

function postRequest(data: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}
```

## Global Setup

**File:** `src/__tests__/setup.ts`

**Purpose:** Initialize global mocks for Prisma before any tests run

**Content:**
```typescript
import { vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    proposal: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    lead: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    // ... other models
  },
}));
```

---

*Testing analysis: 2026-02-26*
