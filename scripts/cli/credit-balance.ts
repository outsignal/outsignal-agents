/**
 * credit-balance.ts
 *
 * CLI wrapper: check credit balance for one or more discovery platforms.
 * Usage: node dist/cli/credit-balance.js --platforms <apollo,prospeo,aiark>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { getPlatformBalance } from "@/lib/discovery/credit-tracker";

const args = process.argv.slice(2);
const platformsIdx = args.indexOf("--platforms");
const platformsStr = platformsIdx !== -1 ? args[platformsIdx + 1] : args[0];

runWithHarness("credit-balance --platforms <platform1,platform2,...>", async () => {
  if (!platformsStr) throw new Error("Missing required argument: --platforms <platform1,platform2,...>");

  const platforms = platformsStr.split(",").map((s) => s.trim());
  const balances = await Promise.all(platforms.map((p) => getPlatformBalance(p)));

  return balances;
});
