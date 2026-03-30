# Phase 58: End-to-End Validation - Research

**Researched:** 2026-03-30
**Domain:** Integration testing, agent pipeline validation, audit trail verification
**Confidence:** HIGH

## Summary

Phase 58 validates the complete v8.0 quality system built in Phases 52-57. The codebase already has a working Vitest setup (v4.x) with 12 test files under `src/__tests__/`, a global Prisma mock in `setup.ts`, and established patterns for mocking AI SDK calls. The agent pipeline flows through `runner.ts` which creates AgentRun audit records, delegates to specialist agents via CLI spawn or direct function calls, and stores results as JSON in the `output` and `steps` fields. The copy quality module (`src/lib/copy-quality.ts`) already has all structural check functions needed for validation scenarios. The portal approve-content route currently warns but does not block -- Phase 57 changes this to HTTP 422. The nova memory system uses flat markdown files per workspace under `.nova/memory/{slug}/`.

The test strategy splits into two layers: (1) fast mocked Vitest tests that verify individual gates (copy quality, channel routing, overlap detection) fire correctly with known inputs, and (2) a CLI-based manual walkthrough script that exercises the real agent pipeline against a seeded e2e-test workspace. The AgentRun model has `input`, `output`, `steps`, `status`, and `error` fields -- all JSON strings that can store quality gate results, rewrite loop details, cost breakdowns, and validator findings without schema changes.

**Primary recommendation:** Build mocked Vitest tests for each quality gate in isolation, create a seed script for the e2e-test workspace, then write a CLI walkthrough harness that runs each scenario and produces a structured failure report.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Mocked unit tests + real API integration tests** -- mocked tests for fast repeatable validation, real API tests for manual E2E walkthroughs that prove the actual pipeline works
- **4 core scenarios + additional edge cases**:
  1. Full happy path (discovery -> quality gate -> list build -> write -> validate -> save)
  2. Deliberate violation + rewrite loop (banned phrases + wrong variables -> validator catches -> writer rewrites -> clean save)
  3. LinkedIn-only channel routing (email enrichment skipped, cost report confirms, list has LinkedIn URLs only)
  4. Portal 422 hard-block (structural violations -> HTTP 422 -> error surfaced to user)
  5. Additional: budget exceeded warning, domain resolution with failures, cross-campaign overlap detection
- **Manual agent walkthrough** -- run the agent through each scenario via CLI, verify outputs
- **Dedicated test workspace** (slug: 'e2e-test') with pre-seeded data
- **Pre-configured memory** (.nova/memory/e2e-test/) with seed profile, ICP, tone prompt
- **All four audit types captured per quality gate**: gate pass/fail, rewrite loop details, cost per stage, validator findings
- **Stored in existing AgentRun model** -- extend metadata/output fields
- **Structured failure report** with scenario name, expected vs actual, which gate failed, reproduction steps
- **Individual scenario re-run** capability
- **Core scenarios become regression tests**

### Claude's Discretion
- Exact test workspace seed data (leads, companies, campaigns)
- Memory seed content for the test workspace
- How structured failure reports are formatted and stored
- Which edge case scenarios are prioritised beyond the core 4
- How regression test runner is structured for future use

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| (no new req IDs) | Full pipeline run completes without errors, final copy clean | Happy path scenario validates all gates in sequence; AgentRun audit trail proves completion |
| (no new req IDs) | Deliberately invalid sequence blocked, rewrite triggered, clean save | Violation scenario exercises copy-quality.ts checks + writer rewrite loop + AgentRun steps log |
| (no new req IDs) | LinkedIn-only run skips email enrichment, cost report correct | Channel routing scenario verifies LEAD-05/PIPE-01 gates working |
| (no new req IDs) | Portal approve-content returns 422 on structural violations | Portal scenario exercises PIPE-05 hard-block route |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | 4.x | Test framework | Already configured in project (`vitest.config.ts`), 12 existing test files |
| @ai-sdk/anthropic | ^3.0.46 | AI model calls | Project standard, agents use this via `generateText` |
| Prisma | ^6.19.2 | Database ORM | Project standard, AgentRun model lives here |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vi.mock (vitest) | built-in | Mock Prisma, AI SDK | All mocked unit tests |
| Node child_process | built-in | CLI spawn for integration tests | Manual walkthrough harness |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest | Jest | Project already uses Vitest, no reason to switch |
| Playwright/E2E browser tests | CLI walkthrough | Portal 422 test could use browser tests but CLI + direct route call is simpler and faster |

**Installation:**
No new dependencies needed. All testing infrastructure exists.

## Architecture Patterns

### Recommended Project Structure
```
src/
  __tests__/
    e2e/
      scenarios/
        happy-path.test.ts          # Mocked happy path gate sequence
        violation-rewrite.test.ts   # Banned phrases -> rewrite -> clean
        linkedin-channel.test.ts    # Channel routing isolation
        portal-422.test.ts          # Portal hard-block
        edge-cases.test.ts          # Budget, overlap, domain resolution
      fixtures/
        seed-data.ts                # Test workspace + people + campaigns
        sample-sequences.ts         # Clean + dirty sequences for testing
      helpers/
        audit-assertions.ts         # AgentRun audit trail verification helpers
        scenario-runner.ts          # Shared scenario execution + failure reporting
    setup.ts                        # Existing global mock setup
scripts/
  e2e/
    seed-workspace.ts               # Creates e2e-test workspace with known data
    run-scenarios.ts                 # Manual CLI walkthrough harness
    report.ts                       # Structured failure report generator
.nova/
  memory/
    e2e-test/
      profile.md                    # Seeded workspace profile
      campaigns.md                  # Empty or seeded
      feedback.md                   # Empty or seeded
      learnings.md                  # Empty or seeded
```

### Pattern 1: Mocked Gate Tests (Fast, Repeatable)
**What:** Unit tests that import quality gate functions directly and verify they produce correct pass/fail results with known inputs. Mock Prisma for AgentRun creation/update.
**When to use:** All 4 core scenarios + edge cases
**Example:**
```typescript
// Source: existing pattern from src/__tests__/normalizer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkCopyQuality, checkSequenceQuality, checkWordCount, checkGreeting, checkCTAFormat } from "@/lib/copy-quality";

describe("Violation + Rewrite Scenario", () => {
  it("detects banned phrases in dirty sequence", () => {
    const dirtySequence = [
      { position: 1, subjectLine: "quick question!", body: "I'd love to pick your brain..." }
    ];
    const violations = checkSequenceQuality(dirtySequence);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some(v => v.violations.includes("quick question"))).toBe(true);
  });

  it("clean sequence passes all gates", () => {
    const cleanSequence = [
      { position: 1, subjectLine: "branded merch", body: "Hi {FIRSTNAME}, ..." }
    ];
    const violations = checkSequenceQuality(cleanSequence);
    expect(violations).toHaveLength(0);
  });
});
```

### Pattern 2: AgentRun Audit Trail Verification
**What:** After running a scenario, query the AgentRun record and verify the `output` and `steps` JSON contains expected audit entries (gate results, rewrite attempts, costs, validator findings).
**When to use:** Every scenario that produces pipeline output
**Example:**
```typescript
// Verify AgentRun contains quality gate audit data
function assertAuditTrail(agentRunOutput: string, expectations: {
  gateResults?: { name: string; severity: string; outcome: "pass" | "fail" }[];
  rewriteLoop?: { attempts: number; finalClean: boolean };
  costs?: { discovery?: number; enrichment?: number; total?: number };
  validatorFindings?: { clean: boolean; violations?: string[] };
}) {
  const parsed = JSON.parse(agentRunOutput);
  if (expectations.gateResults) {
    expect(parsed.qualityGates).toBeDefined();
    for (const expected of expectations.gateResults) {
      const gate = parsed.qualityGates.find((g: any) => g.name === expected.name);
      expect(gate).toBeDefined();
      expect(gate.outcome).toBe(expected.outcome);
    }
  }
  // ... similar for rewrite, costs, validator
}
```

### Pattern 3: CLI Walkthrough Harness (Manual Integration)
**What:** A TypeScript script that invokes the real agent pipeline via CLI commands against the e2e-test workspace, captures outputs, and generates a structured failure report.
**When to use:** Manual E2E verification after all mocked tests pass
**Example:**
```typescript
// scripts/e2e/run-scenarios.ts
import { execSync } from "child_process";

interface ScenarioResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  failedGate?: string;
  reproSteps: string[];
  durationMs: number;
}

async function runScenario(name: string, fn: () => Promise<ScenarioResult>): Promise<ScenarioResult> {
  const start = Date.now();
  try {
    const result = await fn();
    result.durationMs = Date.now() - start;
    return result;
  } catch (error) {
    return {
      name,
      passed: false,
      expected: "no error",
      actual: error instanceof Error ? error.message : String(error),
      reproSteps: [`Run: npx tsx scripts/e2e/run-scenarios.ts --scenario ${name}`],
      durationMs: Date.now() - start,
    };
  }
}
```

### Anti-Patterns to Avoid
- **Testing against production workspaces:** Always use the dedicated e2e-test workspace. Never seed test data into real client workspaces.
- **Asserting on AI-generated text content:** AI output is non-deterministic. Assert on structural properties (violations present/absent, fields exist, gate outcomes) not on exact text.
- **Coupling mocked tests to database state:** Mocked tests should be self-contained with fixture data. Integration tests use the seeded workspace.
- **Skipping AgentRun verification:** Every scenario must verify both pipeline outputs AND audit trail entries. The audit trail is a first-class deliverable, not a side effect.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Copy quality checks | Custom validation logic | `checkCopyQuality()`, `checkSequenceQuality()`, `checkWordCount()`, `checkGreeting()`, `checkCTAFormat()`, `checkSubjectLine()`, `checkLinkedInSpintax()` from `src/lib/copy-quality.ts` | Already implemented in Phase 52, battle-tested, covers all banned patterns |
| Agent execution + audit trail | Custom agent runner | `runAgent()` from `src/lib/agents/runner.ts` | Creates AgentRun records, handles errors, logs steps |
| CLI tool invocation | Direct subprocess calls | `cliSpawn()` from `src/lib/agents/cli-spawn.ts` | Handles JSON envelope parsing, timeouts, error extraction |
| Prisma mocking | Manual mock objects | Existing `src/__tests__/setup.ts` global mock | Already mocks all commonly-used Prisma models |
| Test workspace seeding | Manual DB inserts | Prisma client seed script | Reproducible, can be re-run to reset state |

**Key insight:** Phase 58 validates existing gates -- it should never reimplement them. Tests call the same functions the agents call.

## Common Pitfalls

### Pitfall 1: Non-Deterministic AI Output in Tests
**What goes wrong:** Tests that assert on exact AI-generated copy text fail intermittently because LLM output varies between runs.
**Why it happens:** AI models are inherently non-deterministic even with temperature=0.
**How to avoid:** Assert on structural properties only: number of violations, gate pass/fail, field presence, audit trail entries. Never assert on exact text content from AI calls.
**Warning signs:** Tests that pass sometimes and fail other times with "expected X but received Y" where X and Y are both reasonable copy.

### Pitfall 2: Portal 422 Test Requires Phase 57 Changes
**What goes wrong:** The current approve-content route (as of today) returns 200 with warnings, not 422. Testing for 422 before Phase 57 implements the hard-block will fail.
**Why it happens:** Phase 58 depends on Phase 57 which changes the route behaviour.
**How to avoid:** The mocked test should test the `checkSequenceQuality` function directly and verify violations are detected. The integration test for 422 should be written to match the Phase 57 implementation (which adds severity-based blocking). If Phase 57 isn't complete when tests are written, mark the portal 422 integration test as `.todo()`.
**Warning signs:** Test expects 422 but gets 200.

### Pitfall 3: Test Workspace Pollution
**What goes wrong:** Repeated test runs accumulate data in the e2e-test workspace, causing count-based assertions to fail.
**Why it happens:** Seed script adds data without cleaning up first.
**How to avoid:** The seed script must be idempotent -- delete existing e2e-test data before re-seeding. Use `deleteMany` before `createMany`.
**Warning signs:** Tests pass on first run but fail on second run.

### Pitfall 4: AgentRun.output Schema Drift
**What goes wrong:** Tests assert on specific JSON keys in AgentRun.output, but Phases 53-57 may store quality gate data in different formats.
**Why it happens:** AgentRun.output is a free-form JSON string -- no enforced schema.
**How to avoid:** Define a TypeScript interface for the expected quality gate audit structure. Use it in both the gate implementations (Phases 53-57) and the test assertions. If the interface doesn't match what's actually stored, the test failure tells you exactly what's wrong.
**Warning signs:** `JSON.parse(agentRun.output)` succeeds but expected fields are missing or named differently.

### Pitfall 5: Missing Prisma Models in Global Mock
**What goes wrong:** Tests fail with "prisma.agentRun is not a function" or similar.
**Why it happens:** The existing `setup.ts` mock doesn't include AgentRun, Campaign, TargetList, or DiscoveredPerson.
**How to avoid:** Extend `setup.ts` to add mocks for: `agentRun` (create, update, findMany, findUnique), `campaign` (create, findUnique, update), `targetList` (create, findUnique), `targetListPerson` (createMany), `discoveredPerson` (createMany, findMany), `workspace` (findUnique, create).
**Warning signs:** TypeError on first test run -- easy to fix but blocks all tests until resolved.

## Code Examples

### Existing Copy Quality Functions (Phase 52, verified in codebase)
```typescript
// Source: src/lib/copy-quality.ts
import {
  checkCopyQuality,        // Check text for banned patterns -> { violations, clean }
  checkSequenceQuality,    // Check all steps of a sequence -> SequenceStepViolation[]
  checkWordCount,          // Strategy-aware word count -> CheckResult | null
  checkGreeting,           // First step greeting check -> CheckResult | null
  checkCTAFormat,          // CTA question + AI-cliche check -> CheckResult | null
  checkSubjectLine,        // Subject exclamation + word count -> CheckResult | null
  checkLinkedInSpintax,    // LinkedIn spintax detection -> CheckResult | null
  formatSequenceViolations // Format violations for display -> string
} from "@/lib/copy-quality";

// CheckResult has: { severity: "hard" | "soft", violation: string }
```

### AgentRun Model (Prisma schema)
```prisma
// Source: prisma/schema.prisma line 472
model AgentRun {
  id            String   @id @default(cuid())
  agent         String   // "research" | "leads" | "writer" | "campaign"
  workspaceSlug String?
  input         String   // JSON
  output        String?  // JSON -- quality gate results go here
  status        String   @default("running") // running | complete | failed
  steps         String?  // JSON -- tool call log, rewrite loop details go here
  durationMs    Int?
  inputTokens   Int?
  outputTokens  Int?
  modelId       String?
  parentRunId   String?
  error         String?
  triggeredBy   String?  // "orchestrator" | "cli" | "api" | "pipeline"
  createdAt     DateTime @default(now())
}
```

### Agent Runner Pattern (how audit records are created)
```typescript
// Source: src/lib/agents/runner.ts
// 1. Creates AgentRun with status "running"
// 2. Calls generateText with agent config
// 3. Extracts tool call steps into ToolCallStep[]
// 4. Updates AgentRun with output, steps, duration, tokens
// Quality gate data should be embedded in the output JSON
```

### Existing Test Patterns (Vitest + Prisma mock)
```typescript
// Source: src/__tests__/setup.ts + normalizer.test.ts
// Global Prisma mock in setup.ts (auto-loaded via vitest.config.ts setupFiles)
// AI SDK mocked with: vi.mock("ai", () => ({ generateObject: vi.fn() }));
// Tests import real functions, mock only external dependencies
```

### Nova Memory Structure (per workspace)
```
.nova/memory/{slug}/
  profile.md      # Seed-only, regenerated by seed script. Contains company, ICP, tone, channels.
  campaigns.md    # Copy wins/losses, strategy effectiveness
  feedback.md     # Client tone preferences, approval patterns
  learnings.md    # ICP insights, discovery patterns
```

### Workspace Seed Data Recommendation
```typescript
// For e2e-test workspace:
const E2E_WORKSPACE = {
  slug: "e2e-test",
  name: "E2E Test Workspace",
  vertical: "B2B SaaS",
  status: "active",
  type: "internal",
  package: "email_linkedin",
  enabledModules: '["email","linkedin"]',
  icpIndustries: "SaaS, FinTech",
  icpCountries: "United Kingdom",
  icpCompanySize: "50-200 employees",
  icpDecisionMakerTitles: "CTO, VP Engineering, Head of Product",
  coreOffers: "Cloud infrastructure consulting for scaling SaaS companies",
  painPoints: "Teams wasting engineering time on infrastructure instead of product",
  differentiators: "Ex-AWS engineers, 99.99% uptime guarantee, 24h response SLA",
  caseStudies: "Helped Acme SaaS reduce infrastructure costs by 40% in 3 months",
};

// Seed 10-20 test people with known data:
const E2E_PEOPLE = [
  { email: "jane.doe@testcorp.com", firstName: "Jane", lastName: "Doe", jobTitle: "CTO", company: "TestCorp", linkedinUrl: "https://linkedin.com/in/janedoe" },
  { email: "john.smith@example.com", firstName: "John", lastName: "Smith", jobTitle: "VP Engineering", company: "Example Ltd" },
  // Mix: some with LinkedIn URLs, some without, some with verified emails, some catch-all
];

// Seed 2 campaigns: one email, one LinkedIn-only
// Seed 1 target list linking to the test people
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| approve-content returns 200 + warnings | Phase 57 will return 422 on hard violations | Phase 57 (pending) | Portal 422 test depends on this change |
| AgentRun.output stores raw agent text | Phase 53-57 will embed quality gate metadata in output JSON | Phases 53-57 (pending) | Audit trail assertions depend on the exact structure chosen |
| No test workspace exists | Phase 58 creates dedicated e2e-test workspace | This phase | Enables reproducible integration testing |

**Dependencies on prior phases:**
- Phase 52 (COMPLETE): `copy-quality.ts` extended with severity-tiered checks -- available now
- Phase 53 (PENDING): Platform expertise + input validation -- affects discovery plan scenario
- Phase 54 (PENDING): Writer self-review gate + rewrite loop -- affects violation/rewrite scenario
- Phase 55 (PENDING): Validator agent -- affects validation step in all scenarios
- Phase 56 (PENDING): Leads quality gates -- affects discovery and channel routing scenarios
- Phase 57 (PENDING): Pipeline validation + portal 422 -- affects portal and overlap scenarios

## Open Questions

1. **AgentRun output schema for quality gates**
   - What we know: AgentRun.output is a JSON string, no enforced schema
   - What's unclear: Phases 53-57 haven't been implemented yet -- the exact JSON structure for quality gate results, rewrite loop logs, cost breakdowns, and validator findings hasn't been defined
   - Recommendation: Define a `QualityAuditPayload` TypeScript interface now that Phases 53-57 implementations should conform to. This becomes the contract between gate implementations and E2E test assertions. Example:
     ```typescript
     interface QualityAuditPayload {
       qualityGates?: { name: string; severity: "hard" | "soft"; outcome: "pass" | "fail"; detail?: string }[];
       rewriteLoop?: { originalViolations: string[]; attempts: number; finalClean: boolean };
       costs?: { discovery?: number; enrichment?: number; verification?: number; total?: number };
       validatorFindings?: { clean: boolean; violations?: string[]; coherenceIssues?: string[] };
     }
     ```

2. **Integration test timing vs Phase 53-57 completion**
   - What we know: Phase 58 depends on Phases 52-57 all being complete
   - What's unclear: If Phases 53-57 are still pending when 58 is planned, mocked tests can be written now but integration tests need the real implementations
   - Recommendation: Write mocked tests that validate the gate functions in isolation (these work now with Phase 52 code). Write integration test shells with `.todo()` for scenarios that depend on Phase 53-57 implementations. The CLI walkthrough harness structure can be built now but scenarios run after prior phases complete.

3. **Cost tracking data source**
   - What we know: PIPE-06 specifies cost tracking per pipeline stage, but the exact storage mechanism is TBD (Phase 57)
   - What's unclear: Whether costs will be in AgentRun.output, a separate log, or computed from existing DailyCostTotal/EnrichmentLog records
   - Recommendation: Test should verify costs are *accessible* somewhere after a pipeline run. The assertion helper should check AgentRun.output first, then fall back to querying cost-related tables.

## Sources

### Primary (HIGH confidence)
- `prisma/schema.prisma` -- AgentRun model (line 472), Campaign model (line 677), Workspace model (line 27), TargetList (line 647), DiscoveredPerson (line 211)
- `src/lib/copy-quality.ts` -- All copy quality check functions, Phase 52 implementation
- `src/lib/agents/runner.ts` -- Agent execution engine with AgentRun audit trail
- `src/lib/agents/types.ts` -- Agent type definitions, NOVA_MODEL constant
- `src/lib/agents/orchestrator.ts` -- Delegation tools, CLI spawn paths
- `src/lib/agents/cli-spawn.ts` -- CLI subprocess utility
- `vitest.config.ts` -- Test configuration with path aliases and setup file
- `src/__tests__/setup.ts` -- Global Prisma mock
- `src/__tests__/*.test.ts` -- 12 existing test files showing patterns
- `src/app/api/portal/campaigns/[id]/approve-content/route.ts` -- Current portal approval (200 with warnings, Phase 57 changes to 422)
- `.nova/memory/rise/profile.md` -- Example workspace memory structure
- `package.json` -- Vitest 4.x, test script: `vitest run`

### Secondary (MEDIUM confidence)
- Phase 57 ROADMAP success criteria -- portal 422 behaviour specification (not yet implemented)
- Phases 53-56 ROADMAP descriptions -- quality gate behaviour expectations (not yet implemented)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Vitest already configured, all libraries in place, patterns established
- Architecture: HIGH -- Clear structure based on existing test patterns, no new dependencies
- Pitfalls: HIGH -- Based on direct codebase analysis (mock gaps, portal route behaviour, schema)
- Quality gate functions: HIGH -- Phase 52 code verified in codebase
- AgentRun audit schema: MEDIUM -- Structure for quality gate data not yet defined (depends on Phases 53-57)

**Research date:** 2026-03-30
**Valid until:** 2026-04-30 (stable -- no external dependency changes expected)
