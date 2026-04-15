/**
 * campaign-deploy.ts
 *
 * CLI wrapper: deploy one or more approved campaigns (BL-061).
 *
 * Usage:
 *   node dist/cli/campaign-deploy.js --ids=<id1,id2,...> [flags]
 *   echo "id1\nid2" | node dist/cli/campaign-deploy.js [flags]
 *
 * Flags:
 *   --ids=<csv>               Comma-separated campaign IDs. If omitted, reads
 *                             IDs from stdin (newline or comma separated).
 *   --dry-run                 Validation-only. Does NOT mutate, does NOT fire
 *                             the deploy trigger. Default is LIVE.
 *   --admin-email=<email>     AuditLog attribution. Defaults to 'ops@outsignal.ai'
 *                             — CLI runs as ops-authorised context, matching
 *                             the rationale of patch-content-approved.ts.
 *   --incident=<ref>          Optional incident/ticket ref (e.g. 'BL-061').
 *                             Stamped into AuditLog metadata.
 *
 * Behaviour:
 *   - Parse + dedupe IDs (order preserved on first occurrence).
 *   - Dry-run: calls `initiateCampaignDeploy({ dryRun: true })` for every ID.
 *     Prints per-ID verdict table and exits without mutating anything.
 *   - Live: processes IDs SERIALLY. Awaits each deploy before proceeding.
 *     Stops on the first failure and reports partial progress.
 *   - After each successful live deploy, re-reads the campaign via getCampaign
 *     so the output confirms the post-state (status, deployedAt).
 *   - Wraps the final per-campaign result array + summary in the standard
 *     runWithHarness JSON envelope so the Campaign Agent can parse it.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import {
  initiateCampaignDeploy,
  type InitiateDeployResult,
} from "@/lib/campaigns/deploy-campaign";
import { getCampaign } from "@/lib/campaigns/operations";

const LOG_PREFIX = "[campaign-deploy]";
export const DEFAULT_ADMIN_EMAIL = "ops@outsignal.ai";

export interface ParsedCliArgs {
  ids: string[];
  dryRun: boolean;
  adminEmail: string;
  incident: string | null;
}

function takeFlagValue(arg: string, flag: string): string | null {
  if (arg === flag) return "";
  const prefix = `${flag}=`;
  if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  return null;
}

/**
 * Parse CLI args into a typed shape. Exported for direct unit testing.
 *
 * `stdinIds` is an optional list of IDs read from stdin (already split on
 * whitespace/commas) so the pure parser can be tested without touching
 * process.stdin.
 */
export function parseCliArgs(
  argv: string[],
  stdinIds: string[] = [],
): ParsedCliArgs {
  let dryRun = false;
  let adminEmail = DEFAULT_ADMIN_EMAIL;
  let incident: string | null = null;
  const idsFromFlag: string[] = [];

  for (const raw of argv) {
    if (raw.trim().length === 0) continue;
    if (raw === "--dry-run") {
      dryRun = true;
      continue;
    }
    const idsVal = takeFlagValue(raw, "--ids");
    if (idsVal !== null) {
      for (const piece of idsVal.split(",")) {
        const trimmed = piece.trim();
        if (trimmed.length > 0) idsFromFlag.push(trimmed);
      }
      continue;
    }
    const email = takeFlagValue(raw, "--admin-email");
    if (email !== null) {
      if (email.length > 0) adminEmail = email;
      continue;
    }
    const inc = takeFlagValue(raw, "--incident");
    if (inc !== null) {
      incident = inc.length > 0 ? inc : null;
      continue;
    }
    if (raw.startsWith("--")) {
      throw new Error(`Unknown flag: ${raw}`);
    }
    // Positional args not supported — users must pass via --ids or stdin so
    // the source is unambiguous.
    throw new Error(
      `Unexpected positional argument '${raw}'. Use --ids=<csv> or pipe IDs via stdin.`,
    );
  }

  // Merge flag IDs + stdin IDs, preserving order of first occurrence.
  const merged = [...idsFromFlag, ...stdinIds];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of merged) {
    if (id.length === 0) continue;
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  if (ids.length === 0) {
    throw new Error(
      "No campaign IDs supplied. Pass via --ids=<csv> or pipe IDs via stdin.",
    );
  }

  return { ids, dryRun, adminEmail, incident };
}

/**
 * Split a raw stdin buffer into trimmed, non-empty IDs. Accepts newline- or
 * comma-separated input. Exported for unit tests.
 */
export function splitStdinIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Read stdin to string (no-op when TTY attached). Returns "" if the caller
 * is not piping input, so the CLI falls back cleanly to --ids= parsing.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface PerCampaignOutcome {
  id: string;
  workspace: string | null;
  name: string | null;
  beforeStatus: string | null;
  afterStatus: string | null;
  deployId: string | null;
  /** Post-verify snapshot (live only). */
  verifiedStatus?: string | null;
  verifiedDeployedAt?: string | null;
  /** "would-deploy" (dry-run ok), "deployed" (live ok), "error" (either mode). */
  verdict: "would-deploy" | "deployed" | "error";
  errorCode?: string;
  errorReason?: string;
  /**
   * Operator-facing warning attached to synthetic failure rows produced when
   * `initiateCampaignDeploy` throws mid-batch. Flags the possibility that the
   * campaign row flipped to `deployed` before the throw (e.g. tasks.trigger
   * rejected after `updateMany` already committed), leaving an orphaned
   * CampaignDeploy row that needs manual reconciliation.
   */
  errorWarning?: string;
}

/**
 * Collapse a helper result into the compact per-campaign row used in the CLI
 * output table + JSON envelope.
 */
export function classifyResult(
  id: string,
  result: InitiateDeployResult,
): PerCampaignOutcome {
  if (!result.ok) {
    return {
      id,
      workspace: result.workspaceSlug ?? null,
      name: result.campaignName ?? null,
      beforeStatus: result.beforeStatus ?? null,
      afterStatus: null,
      deployId: null,
      verdict: "error",
      errorCode: result.code,
      errorReason: result.reason,
    };
  }
  return {
    id,
    workspace: result.workspaceSlug,
    name: result.campaignName,
    beforeStatus: result.beforeStatus,
    afterStatus: result.afterStatus,
    deployId: result.deployId,
    verdict: result.dryRun ? "would-deploy" : "deployed",
  };
}

export interface SummaryEnvelope {
  mode: "dry-run" | "live";
  adminEmail: string;
  incident: string | null;
  total: number;
  success: number;
  failure: number;
  /** True when mode=live AND we stopped after the first failure. */
  stoppedEarly: boolean;
  results: PerCampaignOutcome[];
}

const ZOMBIE_DEPLOY_WARNING =
  "possible zombie deploy — campaign may be in `deployed` state with " +
  "orphaned CampaignDeploy row; manually verify via `getCampaign` + " +
  "`campaignDeploy.findFirst` before retrying";

export async function main(): Promise<SummaryEnvelope> {
  const stdinRaw = await readStdin();
  const stdinIds = splitStdinIds(stdinRaw);
  const args = parseCliArgs(process.argv.slice(2), stdinIds);

  process.stderr.write(
    `${LOG_PREFIX} mode=${args.dryRun ? "DRY-RUN" : "LIVE"} ids=${args.ids.length} adminEmail=${args.adminEmail} incident=${args.incident ?? "(none)"}\n`,
  );

  const results: PerCampaignOutcome[] = [];
  let stoppedEarly = false;

  for (const id of args.ids) {
    let outcome: PerCampaignOutcome;

    try {
      const result = await initiateCampaignDeploy({
        campaignId: id,
        adminEmail: args.adminEmail,
        dryRun: args.dryRun,
      });
      outcome = classifyResult(id, result);
    } catch (err) {
      // The helper threw (e.g. tasks.trigger rejected AFTER `updateMany`
      // already flipped status to `deployed` and CampaignDeploy was created).
      // Synthesize a failure row so the operator retains every prior per-ID
      // outcome plus a loud warning about the possible zombie deploy.
      const errMsg = err instanceof Error ? err.message : String(err);
      outcome = {
        id,
        workspace: null,
        name: null,
        beforeStatus: null,
        afterStatus: null,
        deployId: null,
        verdict: "error",
        errorCode: "helper_threw",
        errorReason: errMsg,
        errorWarning: ZOMBIE_DEPLOY_WARNING,
      };
      process.stderr.write(
        `${LOG_PREFIX} !!!! HELPER THREW for ${id}: ${errMsg}\n` +
          `${LOG_PREFIX} !!!! ${ZOMBIE_DEPLOY_WARNING}\n`,
      );
      results.push(outcome);
      stoppedEarly = true;
      process.stderr.write(
        `${LOG_PREFIX} halted on first failure. ${results.length}/${args.ids.length} processed.\n`,
      );
      break;
    }

    // Post-verify: re-read the campaign to confirm the post-state landed.
    // Dry-run skips this — nothing mutated.
    if (!args.dryRun && outcome.verdict === "deployed") {
      try {
        const verify = await getCampaign(id);
        outcome.verifiedStatus = verify?.status ?? null;
        outcome.verifiedDeployedAt = verify?.deployedAt
          ? verify.deployedAt.toISOString()
          : null;
      } catch (err) {
        // Post-verify failure is non-fatal — the deploy itself landed. Surface
        // it in stderr but don't flip the verdict.
        process.stderr.write(
          `${LOG_PREFIX} WARN: post-verify failed for ${id}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }

    results.push(outcome);

    // Per-campaign log line to stderr (JSON envelope goes to stdout at the end).
    if (outcome.verdict === "error") {
      process.stderr.write(
        `${LOG_PREFIX} FAIL ${id} — ${outcome.errorCode}: ${outcome.errorReason}\n`,
      );
    } else {
      const verifiedSuffix =
        outcome.verifiedStatus !== undefined
          ? ` verifiedStatus=${outcome.verifiedStatus} verifiedDeployedAt=${outcome.verifiedDeployedAt ?? "null"}`
          : "";
      process.stderr.write(
        `${LOG_PREFIX} ${outcome.verdict === "would-deploy" ? "WOULD DEPLOY" : "DEPLOYED"} ${id} (${outcome.workspace ?? "?"} — ${outcome.name ?? "?"}) ${outcome.beforeStatus}->${outcome.afterStatus}${outcome.deployId ? ` deployId=${outcome.deployId}` : ""}${verifiedSuffix}\n`,
      );
    }

    // Stop-on-first-failure applies in LIVE mode only. Dry-run reports every
    // verdict so the operator can see the full picture before running live.
    if (!args.dryRun && outcome.verdict === "error") {
      stoppedEarly = true;
      process.stderr.write(
        `${LOG_PREFIX} halted on first failure. ${results.length}/${args.ids.length} processed.\n`,
      );
      break;
    }
  }

  const success = results.filter(
    (r) => r.verdict === "deployed" || r.verdict === "would-deploy",
  ).length;
  const failure = results.filter((r) => r.verdict === "error").length;

  process.stderr.write(
    `${LOG_PREFIX} summary success=${success} failure=${failure} total=${args.ids.length}${stoppedEarly ? " (stopped early)" : ""}\n`,
  );

  return {
    mode: args.dryRun ? "dry-run" : "live",
    adminEmail: args.adminEmail,
    incident: args.incident,
    total: args.ids.length,
    success,
    failure,
    stoppedEarly,
    results,
  };
}

// Only run when invoked as a script — NOT when imported in tests.
const invokedAsScript =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  (process.argv[1]?.endsWith("campaign-deploy.ts") ||
    process.argv[1]?.endsWith("campaign-deploy.js"));

if (invokedAsScript) {
  runWithHarness(
    "campaign-deploy --ids=<csv> [--dry-run] [--admin-email=<email>] [--incident=<ref>]",
    main,
  );
}
