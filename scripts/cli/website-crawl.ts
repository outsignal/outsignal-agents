/**
 * website-crawl.ts
 *
 * CLI wrapper script: deep crawl a website and return page content as markdown.
 * Usage: node dist/cli/website-crawl.js <url> [maxPages]
 *
 * Returns markdown content for up to maxPages pages (default 5).
 * Used by the Research agent to analyze client websites.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { researchTools } from "@/lib/agents/research";

const [, , url, maxPagesStr] = process.argv;
const maxPages = maxPagesStr ? parseInt(maxPagesStr, 10) : 5;

runWithHarness("website-crawl <url> [maxPages]", async () => {
  if (!url) throw new Error("Missing required argument: url");
  return researchTools.crawlWebsite.execute({ url, maxPages });
});
