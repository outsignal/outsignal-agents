/**
 * url-scrape.ts
 *
 * CLI wrapper script: scrape a single URL and return its content as markdown.
 * Usage: node dist/cli/url-scrape.js <url>
 *
 * Returns the page content as markdown. Used by the Research agent
 * for targeted page analysis (e.g. pricing, about, case studies).
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { researchTools } from "@/lib/agents/research";

const [, , url] = process.argv;

runWithHarness("url-scrape <url>", async () => {
  if (!url) throw new Error("Missing required argument: url");
  return researchTools.scrapeUrl.execute({ url });
});
