/**
 * reject-campaign-content.ts
 *
 * CLI wrapper script: reject previously approved campaign content so updated
 * copy can be saved and sent back through the standard approval flow.
 * Usage: node dist/cli/reject-campaign-content.js --campaignId <campaignId>
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { rejectCampaignContent } from "@/lib/campaigns/operations";

export const DEFAULT_REJECTION_FEEDBACK =
  "Content rejected via ops CLI to allow revised copy to be saved for re-approval.";

export interface ParsedRejectCampaignContentArgs {
  campaignId: string;
}

function takeFlagValue(arg: string, flag: string): string | null {
  if (arg === flag) return "";
  const prefix = `${flag}=`;
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return null;
}

export function parseCliArgs(
  argv: string[],
): ParsedRejectCampaignContentArgs {
  let campaignId: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw || raw.trim().length === 0) continue;

    const inlineCampaignId = takeFlagValue(raw, "--campaignId");
    if (inlineCampaignId !== null) {
      const nextValue =
        inlineCampaignId.length > 0 ? inlineCampaignId : argv[++i] ?? "";
      if (nextValue.startsWith("--")) {
        throw new Error("Missing required argument: --campaignId");
      }
      campaignId = nextValue.trim();
      continue;
    }

    if (raw.startsWith("--")) {
      throw new Error(`Unknown flag: ${raw}`);
    }

    throw new Error(
      `Unexpected positional argument '${raw}'. Use --campaignId <id>.`,
    );
  }

  if (!campaignId) {
    throw new Error("Missing required argument: --campaignId");
  }

  return { campaignId };
}

export async function rejectCampaignContentFromCli(
  args: ParsedRejectCampaignContentArgs,
) {
  return rejectCampaignContent(args.campaignId, DEFAULT_REJECTION_FEEDBACK);
}

export async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  return rejectCampaignContentFromCli(args);
}

const invokedAsScript =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  (process.argv[1]?.endsWith("reject-campaign-content.ts") ||
    process.argv[1]?.endsWith("reject-campaign-content.js"));

if (invokedAsScript) {
  runWithHarness("reject-campaign-content --campaignId <campaignId>", main);
}
