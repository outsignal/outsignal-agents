/**
 * proposal-list.ts
 *
 * CLI wrapper: list proposals with optional status filter.
 * Usage: node dist/cli/proposal-list.js [status]
 *
 * status: draft|sent|accepted|paid|onboarding_complete
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , status] = process.argv;

runWithHarness("proposal-list [status]", async () => {
  return orchestratorTools.listProposals.execute({
    status: (status || undefined) as "draft" | "sent" | "accepted" | "paid" | "onboarding_complete" | undefined,
  });
});
