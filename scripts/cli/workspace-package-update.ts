/**
 * workspace-package-update.ts
 *
 * CLI wrapper: update a workspace's campaign package configuration.
 * Usage: node dist/cli/workspace-package-update.js <workspaceSlug> <jsonFile>
 *
 * JSON file format: { "enabledModules": ["email", "linkedin"], "monthlyLeadQuota": 2000 }
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { readFileSync } from "fs";
import { runWithHarness } from "./_cli-harness";
import { orchestratorTools } from "@/lib/agents/orchestrator";

const [, , workspaceSlug, jsonFile] = process.argv;

runWithHarness("workspace-package-update <workspaceSlug> <jsonFile>", async () => {
  if (!workspaceSlug) throw new Error("Missing required argument: workspaceSlug");
  if (!jsonFile) throw new Error("Missing required argument: jsonFile");
  const params = JSON.parse(readFileSync(jsonFile, "utf8")) as Record<string, unknown>;
  return orchestratorTools.updateWorkspacePackage.execute({ workspaceSlug, ...params } as Parameters<typeof orchestratorTools.updateWorkspacePackage.execute>[0]);
});
