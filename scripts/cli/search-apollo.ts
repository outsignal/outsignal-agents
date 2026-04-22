/**
 * search-apollo.ts
 *
 * CLI wrapper: search Apollo.io for people matching ICP filters.
 * Apollo is currently disabled — this wrapper now fails closed with a
 * clear operator-facing error until the subscription is restored.
 * Usage: node dist/cli/search-apollo.js <workspaceSlug> <jsonFile>
 *
 * JSON file format: { "jobTitles": [...], "seniority": [...], "industries": [...], ... }
 * Search is FREE (no credits). Returns identity data only.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { APOLLO_DISABLED_MESSAGE } from "@/lib/discovery/apollo-disabled";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("search-apollo <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");

  // Apollo is intentionally disabled until the workspace has a valid
  // subscription again. Keep the CLI fail-closed so an operator can't
  // accidentally burn time on a dead discovery path.
  throw new Error(APOLLO_DISABLED_MESSAGE);
});
