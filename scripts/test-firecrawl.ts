/**
 * Quick test to verify Firecrawl integration works.
 * Usage: npx tsx scripts/test-firecrawl.ts [url]
 */

import { crawlWebsite, scrapeUrl } from "../src/lib/firecrawl/client";

const url = process.argv[2] || "https://outsignal.ai";

async function main() {
  console.log(`\n=== Testing Firecrawl ===`);
  console.log(`URL: ${url}\n`);

  // Test single page scrape
  console.log("1. Testing scrapeUrl (single page)...");
  try {
    const page = await scrapeUrl(url);
    console.log(`   Title: ${page.title ?? "N/A"}`);
    console.log(`   Markdown length: ${page.markdown.length} chars`);
    console.log(`   Preview: ${page.markdown.slice(0, 200)}...`);
    console.log("   ✓ scrapeUrl works\n");
  } catch (err) {
    console.error("   ✗ scrapeUrl failed:", err);
  }

  // Test multi-page crawl (limit to 3 pages for speed)
  console.log("2. Testing crawlWebsite (multi-page, max 3)...");
  try {
    const pages = await crawlWebsite(url, { maxPages: 3 });
    console.log(`   Pages crawled: ${pages.length}`);
    for (const page of pages) {
      console.log(`   - ${page.title ?? "Untitled"} (${page.url}) — ${page.markdown.length} chars`);
    }
    console.log("   ✓ crawlWebsite works\n");
  } catch (err) {
    console.error("   ✗ crawlWebsite failed:", err);
  }

  console.log("=== Done ===");
}

main().catch(console.error);
