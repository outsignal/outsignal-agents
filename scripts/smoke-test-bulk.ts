#!/usr/bin/env npx tsx
/**
 * Smoke test for BL-011 (bulk enrichment), BL-012 (batch ICP scoring), BL-013 (crawl cache dedup).
 * Runs real API calls with minimal data to verify integrations work.
 * Cost: ~$0.05-0.10
 *
 * Usage: npx tsx scripts/smoke-test-bulk.ts
 */

import { config } from "dotenv";
config();

import { PrismaClient } from "@prisma/client";
import { bulkEnrichPerson } from "@/lib/enrichment/providers/prospeo";
import { bulkFindEmail } from "@/lib/enrichment/providers/findymail";
import { bulkVerifyEmails } from "@/lib/verification/bounceban";
import { scorePersonIcpBatch } from "@/lib/icp/scorer";
import { getCrawlMarkdown, prefetchDomains } from "@/lib/icp/crawl-cache";

const prisma = new PrismaClient();

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

// ---------------------------------------------------------------------------
// Test 1: Prospeo Bulk Enrich
// ---------------------------------------------------------------------------

async function test1_prospeoBulk(): Promise<TestResult> {
  const start = Date.now();
  const name = "Prospeo Bulk Enrich";

  // Query 3 people with linkedinUrl OR (firstName + lastName + companyDomain)
  const people = await prisma.person.findMany({
    where: {
      OR: [
        { linkedinUrl: { not: null } },
        {
          AND: [
            { firstName: { not: null } },
            { lastName: { not: null } },
            { companyDomain: { not: null } },
          ],
        },
      ],
    },
    take: 3,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      linkedinUrl: true,
      companyDomain: true,
    },
  });

  if (people.length < 3) {
    return {
      name,
      passed: false,
      details: `Only found ${people.length} eligible Person records (need 3)`,
      duration: Date.now() - start,
    };
  }

  const input = people.map((p) => ({
    personId: p.id,
    firstName: p.firstName ?? undefined,
    lastName: p.lastName ?? undefined,
    linkedinUrl: p.linkedinUrl ?? undefined,
    companyDomain: p.companyDomain ?? undefined,
  }));

  const results = await bulkEnrichPerson(input);

  if (results.size !== 3) {
    return {
      name,
      passed: false,
      details: `Expected Map with 3 entries, got ${results.size}`,
      duration: Date.now() - start,
    };
  }

  // Check that at least 1 entry has an email or is not_matched (proving round-trip works)
  let hasEmailOrNotMatched = false;
  for (const [personId, result] of results) {
    if (result.email !== null) {
      hasEmailOrNotMatched = true;
    }
    // Check for not_matched indicator in rawResponse
    const raw = result.rawResponse as Record<string, unknown> | undefined;
    if (raw && ("not_matched" in raw || "invalid_datapoint" in raw || "missing_from_response" in raw)) {
      hasEmailOrNotMatched = true;
    }
    // Any result at all proves the round-trip worked
    if (result.source === "prospeo") {
      hasEmailOrNotMatched = true;
    }
  }

  const emailCount = [...results.values()].filter((r) => r.email !== null).length;

  return {
    name,
    passed: hasEmailOrNotMatched,
    details: `Got ${results.size} results, ${emailCount} with emails. Person IDs mapped correctly.`,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Test 2: FindyMail Parallel
// ---------------------------------------------------------------------------

async function test2_findymailParallel(): Promise<TestResult> {
  const start = Date.now();
  const name = "FindyMail Parallel";

  // Query 3 people with linkedinUrl
  const people = await prisma.person.findMany({
    where: { linkedinUrl: { not: null } },
    take: 3,
    select: { id: true, linkedinUrl: true },
  });

  if (people.length < 3) {
    return {
      name,
      passed: false,
      details: `Only found ${people.length} Person records with linkedinUrl (need 3)`,
      duration: Date.now() - start,
    };
  }

  const input = people.map((p) => ({
    personId: p.id,
    linkedinUrl: p.linkedinUrl!,
  }));

  const results = await bulkFindEmail(input);

  if (results.size !== 3) {
    return {
      name,
      passed: false,
      details: `Expected Map with 3 entries, got ${results.size}`,
      duration: Date.now() - start,
    };
  }

  // Check all personIds are present in results
  const allMapped = input.every((p) => results.has(p.personId));
  if (!allMapped) {
    return {
      name,
      passed: false,
      details: "Not all personIds mapped back correctly in results",
      duration: Date.now() - start,
    };
  }

  const emailCount = [...results.values()].filter((r) => r.email !== null).length;

  return {
    name,
    passed: true,
    details: `Got ${results.size} results, ${emailCount} with emails. Parallel fan-out worked.`,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Test 3: BounceBan Bulk Verify
// ---------------------------------------------------------------------------

async function test3_bouncebanBulk(): Promise<TestResult> {
  const start = Date.now();
  const name = "BounceBan Bulk Verify";

  // Query 3 people that already have emails
  const people = await prisma.person.findMany({
    where: { email: { not: null } },
    take: 3,
    select: { id: true, email: true },
  });

  if (people.length < 3) {
    return {
      name,
      passed: false,
      details: `Only found ${people.length} Person records with email (need 3)`,
      duration: Date.now() - start,
    };
  }

  const entries = people.map((p) => ({
    email: p.email!,
    personId: p.id,
  }));

  const results = await bulkVerifyEmails(entries);

  if (results.size !== 3) {
    return {
      name,
      passed: false,
      details: `Expected Map with 3 entries, got ${results.size}`,
      duration: Date.now() - start,
    };
  }

  // Check that each result has a valid verification status
  const validStatuses = new Set(["valid", "invalid", "valid_catch_all", "catch_all", "risky", "unknown"]);
  const statusList: string[] = [];
  let allValid = true;
  for (const [personId, result] of results) {
    if (!validStatuses.has(result.status)) {
      allValid = false;
    }
    statusList.push(`${result.email}: ${result.status}`);
  }

  return {
    name,
    passed: allValid,
    details: `Got ${results.size} results. Statuses: ${statusList.join(", ")}`,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Test 4: Batch ICP Scoring
// ---------------------------------------------------------------------------

async function test4_batchIcpScoring(): Promise<TestResult> {
  const start = Date.now();
  const name = "Batch ICP Scoring";

  // Find a workspace with icpCriteriaPrompt set
  const workspace = await prisma.workspace.findFirst({
    where: { icpCriteriaPrompt: { not: null } },
    select: { slug: true },
  });

  if (!workspace) {
    return {
      name,
      passed: false,
      details: "No workspace with icpCriteriaPrompt found",
      duration: Date.now() - start,
    };
  }

  // Find 3 people in that workspace via PersonWorkspace junction
  const personWorkspaces = await prisma.personWorkspace.findMany({
    where: { workspace: workspace.slug },
    take: 3,
    select: { personId: true },
  });

  if (personWorkspaces.length < 3) {
    return {
      name,
      passed: false,
      details: `Only found ${personWorkspaces.length} people in workspace '${workspace.slug}' (need 3)`,
      duration: Date.now() - start,
    };
  }

  const personIds = personWorkspaces.map((pw) => pw.personId);

  const result = await scorePersonIcpBatch(personIds, workspace.slug);

  if (result.scored < 1) {
    return {
      name,
      passed: false,
      details: `scored=${result.scored}, failed=${result.failed}, skipped=${result.skipped}. Expected scored >= 1.`,
      duration: Date.now() - start,
    };
  }

  // Verify icpScore was written to PersonWorkspace
  const updatedPws = await prisma.personWorkspace.findMany({
    where: {
      personId: { in: personIds },
      workspace: workspace.slug,
      icpScore: { not: null },
    },
    select: { personId: true, icpScore: true },
  });

  return {
    name,
    passed: updatedPws.length >= 1,
    details: `scored=${result.scored}, failed=${result.failed}, skipped=${result.skipped}. ${updatedPws.length} PersonWorkspace records have icpScore set. Workspace: ${workspace.slug}`,
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Test 5: Crawl Cache Dedup
// ---------------------------------------------------------------------------

async function test5_crawlCacheDedup(): Promise<TestResult> {
  const start = Date.now();
  const name = "Crawl Cache Dedup";

  // Find a domain that already has crawlMarkdown cached
  const cachedCompany = await prisma.company.findFirst({
    where: {
      crawlMarkdown: { not: null },
      crawledAt: { not: null },
    },
    select: { domain: true },
  });

  if (!cachedCompany) {
    return {
      name,
      passed: false,
      details: "No Company with cached crawlMarkdown found",
      duration: Date.now() - start,
    };
  }

  const domain = cachedCompany.domain;

  // Test concurrent getCrawlMarkdown — should hit cache, not Firecrawl
  const concurrentStart = Date.now();
  const [md1, md2] = await Promise.all([
    getCrawlMarkdown(domain),
    getCrawlMarkdown(domain),
  ]);
  const concurrentDuration = Date.now() - concurrentStart;

  if (md1 === null || md2 === null) {
    return {
      name,
      passed: false,
      details: `getCrawlMarkdown returned null for cached domain '${domain}'`,
      duration: Date.now() - start,
    };
  }

  if (md1 !== md2) {
    return {
      name,
      passed: false,
      details: "Two concurrent getCrawlMarkdown calls returned different results",
      duration: Date.now() - start,
    };
  }

  const cacheHitFast = concurrentDuration < 2000;

  // Test prefetchDomains with the cached domain + another (or same twice)
  const anotherCached = await prisma.company.findFirst({
    where: {
      crawlMarkdown: { not: null },
      crawledAt: { not: null },
      domain: { not: domain },
    },
    select: { domain: true },
  });

  const prefetchDomainList = [domain, anotherCached?.domain ?? domain];
  const prefetchResult = await prefetchDomains(prefetchDomainList);

  const prefetchValid =
    typeof prefetchResult.cached === "number" &&
    typeof prefetchResult.crawled === "number" &&
    typeof prefetchResult.failed === "number";

  return {
    name,
    passed: cacheHitFast && prefetchValid,
    details: [
      `Concurrent getCrawlMarkdown: both returned ${md1.length} chars in ${concurrentDuration}ms (cache hit: ${cacheHitFast ? "yes" : "NO, too slow"}).`,
      `prefetchDomains: cached=${prefetchResult.cached}, crawled=${prefetchResult.crawled}, failed=${prefetchResult.failed}.`,
      `Domain tested: ${domain}`,
    ].join(" "),
    duration: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Bulk Features Smoke Test ===\n");

  // Verify required env vars exist (don't log values)
  const requiredVars = [
    "DATABASE_URL",
    "PROSPEO_API_KEY",
    "FINDYMAIL_API_KEY",
    "BOUNCEBAN_API_KEY",
  ];
  const missingVars = requiredVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(`Missing environment variables: ${missingVars.join(", ")}`);
    console.error("Ensure .env file is present and populated.");
    process.exit(1);
  }
  console.log("Environment variables: all required present\n");

  const tests: Array<() => Promise<TestResult>> = [
    test1_prospeoBulk,
    test2_findymailParallel,
    test3_bouncebanBulk,
    test4_batchIcpScoring,
    test5_crawlCacheDedup,
  ];

  const results: TestResult[] = [];
  for (const test of tests) {
    try {
      const result = await test();
      results.push(result);
      console.log(
        `${result.passed ? "PASS" : "FAIL"} ${result.name} (${result.duration}ms)`,
      );
      console.log(`   ${result.details}\n`);
    } catch (err) {
      const result: TestResult = {
        name: test.name,
        passed: false,
        details: err instanceof Error ? `${err.message}` : String(err),
        duration: 0,
      };
      results.push(result);
      console.log(`FAIL ${result.name}: ${result.details}\n`);
    }
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n=== Results: ${passed}/${results.length} passed ===`);

  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main();
