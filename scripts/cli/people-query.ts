/**
 * people-query.ts
 *
 * CLI wrapper: query people from the database with optional filters.
 * Usage: node dist/cli/people-query.js [workspaceSlug] [status] [limit]
 *
 * Defaults to limit 50 to prevent context overflow.
 * status: new|contacted|replied|interested|bounced|unsubscribed
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , workspaceSlug, status, limitStr] = process.argv;
const limit = limitStr ? parseInt(limitStr, 10) : 50;

runWithHarness("people-query [workspaceSlug] [status] [limit]", async () => {
  return orchestratorTools.queryPeople.execute({
    workspaceSlug: workspaceSlug || undefined,
    status: (status || undefined) as "new" | "contacted" | "replied" | "interested" | "bounced" | "unsubscribed" | undefined,
    limit,
  });
});
