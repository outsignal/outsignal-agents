/**
 * Check UK Shopify store domains for active Google Ads using Adyntel API
 *
 * Usage: npx tsx scripts/cli/check-google-ads-adyntel.ts
 *
 * - Reads domains from data/storecensus-domains.txt
 * - Checks each domain via POST /google on api.adyntel.com
 * - Saves results incrementally to data/blanktag-adyntel-results.json
 * - Resumable: skips domains already checked
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const API_URL = "https://api.adyntel.com/google";
const EMAIL = "jonathan@outsignal.ai";
const API_KEY = "hd-e72e66482fdeb3c6f0-8";
const COUNTRY_CODE = "GB";
const CONCURRENCY = 15;
const DELAY_BETWEEN_BATCHES_MS = 100; // small delay between batches to be respectful

const DATA_DIR = resolve(__dirname, "../../data");
const DOMAINS_FILE = resolve(DATA_DIR, "storecensus-domains.txt");
const RESULTS_FILE = resolve(DATA_DIR, "blanktag-adyntel-results.json");

interface DomainResult {
  domain: string;
  hasGoogleAds: boolean;
  totalAdCount: number;
  advertiserName: string | null;
  checkedAt: string;
  error?: string;
}

interface ResultsData {
  startedAt: string;
  lastUpdatedAt: string;
  totalDomains: number;
  checkedCount: number;
  withAdsCount: number;
  errorCount: number;
  results: Record<string, DomainResult>;
}

function loadResults(): ResultsData {
  if (existsSync(RESULTS_FILE)) {
    const raw = readFileSync(RESULTS_FILE, "utf-8");
    return JSON.parse(raw);
  }
  return {
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    totalDomains: 0,
    checkedCount: 0,
    withAdsCount: 0,
    errorCount: 0,
    results: {},
  };
}

function saveResults(data: ResultsData): void {
  data.lastUpdatedAt = new Date().toISOString();
  data.checkedCount = Object.keys(data.results).length;
  data.withAdsCount = Object.values(data.results).filter(
    (r) => r.hasGoogleAds
  ).length;
  data.errorCount = Object.values(data.results).filter(
    (r) => r.error
  ).length;
  writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

async function checkDomain(domain: string): Promise<DomainResult> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: EMAIL,
        api_key: API_KEY,
        company_domain: domain,
        country_code: COUNTRY_CODE,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        domain,
        hasGoogleAds: false,
        totalAdCount: 0,
        advertiserName: null,
        checkedAt: new Date().toISOString(),
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await res.json();
    const totalAdCount = data.total_ad_count ?? 0;
    const advertiserName =
      totalAdCount > 0 && data.ads?.length > 0
        ? data.ads[0].advertiser_name ?? null
        : null;

    return {
      domain,
      hasGoogleAds: totalAdCount > 0,
      totalAdCount,
      advertiserName,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      domain,
      hasGoogleAds: false,
      totalAdCount: 0,
      advertiserName: null,
      checkedAt: new Date().toISOString(),
      error: err.message?.slice(0, 200) ?? "Unknown error",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // Load domains
  const allDomains = readFileSync(DOMAINS_FILE, "utf-8")
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);

  console.log(`Total domains in file: ${allDomains.length}`);

  // Load existing results
  const resultsData = loadResults();
  resultsData.totalDomains = allDomains.length;

  // Filter out already-checked domains
  const remaining = allDomains.filter((d) => !resultsData.results[d]);
  console.log(`Already checked: ${allDomains.length - remaining.length}`);
  console.log(`Remaining to check: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("All domains already checked!");
    printSummary(resultsData);
    return;
  }

  // Check credits
  const creditsRes = await fetch("https://api.adyntel.com/credits_check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, api_key: API_KEY }),
  });
  const creditsData = await creditsRes.json();
  console.log(`Current credits: ${creditsData.current_credits}`);

  if (creditsData.current_credits < remaining.length) {
    console.warn(
      `WARNING: Only ${creditsData.current_credits} credits but ${remaining.length} domains to check`
    );
  }

  const startTime = Date.now();
  let processed = 0;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(checkDomain));

    for (const result of results) {
      resultsData.results[result.domain] = result;
    }
    processed += batch.length;

    // Save every batch
    saveResults(resultsData);

    // Log progress every 100 domains
    if (processed % 100 < CONCURRENCY || i + CONCURRENCY >= remaining.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (processed / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(
        `[${elapsed}s] Checked ${resultsData.checkedCount}/${allDomains.length} | ` +
          `With ads: ${resultsData.withAdsCount} | ` +
          `Errors: ${resultsData.errorCount} | ` +
          `Rate: ${rate}/s`
      );
    }

    // Check for fatal errors (e.g. credits depleted)
    const recentErrors = results.filter((r) => r.error);
    if (recentErrors.length === batch.length && batch.length > 1) {
      console.error("All requests in batch failed. Checking credits...");
      const checkRes = await fetch("https://api.adyntel.com/credits_check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, api_key: API_KEY }),
      });
      const checkData = await checkRes.json();
      if (checkData.current_credits <= 0) {
        console.error("CREDITS DEPLETED. Stopping.");
        break;
      }
      // If credits are fine but all failed, might be rate limited — slow down
      console.warn("Slowing down due to batch failure...");
      await sleep(5000);
    }

    // Small delay between batches
    if (i + CONCURRENCY < remaining.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  printSummary(resultsData);
}

function printSummary(data: ResultsData) {
  console.log("\n=== FINAL SUMMARY ===");
  console.log(`Total domains: ${data.totalDomains}`);
  console.log(`Checked: ${data.checkedCount}`);
  console.log(`With Google Ads: ${data.withAdsCount}`);
  console.log(`Without Google Ads: ${data.checkedCount - data.withAdsCount - data.errorCount}`);
  console.log(`Errors: ${data.errorCount}`);
  console.log(
    `Hit rate: ${((data.withAdsCount / (data.checkedCount - data.errorCount)) * 100).toFixed(1)}%`
  );

  // List domains with ads
  const withAds = Object.values(data.results)
    .filter((r) => r.hasGoogleAds)
    .sort((a, b) => b.totalAdCount - a.totalAdCount);

  if (withAds.length > 0) {
    console.log(`\n=== DOMAINS WITH GOOGLE ADS (${withAds.length}) ===`);
    for (const r of withAds) {
      console.log(
        `  ${r.domain} — ${r.totalAdCount} ads${r.advertiserName ? ` (${r.advertiserName})` : ""}`
      );
    }
  }

  console.log(`\nResults saved to: ${RESULTS_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
