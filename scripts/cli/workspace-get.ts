/**
 * workspace-get.ts
 *
 * CLI wrapper script: fetch a workspace record by slug.
 * Usage: node dist/cli/workspace-get.js <slug>
 *
 * Smoke-test script for the CLI compilation pipeline.
 * Validates: @/ alias resolution, Prisma external, dotenv loading, harness, sanitization.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";

const [, , slug] = process.argv;

runWithHarness("workspace-get <slug>", async () => {
  if (!slug) throw new Error("Missing required argument: slug");

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) throw new Error(`Workspace '${slug}' not found`);

  return ws;
});
