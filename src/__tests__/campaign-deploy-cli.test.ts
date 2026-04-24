/**
 * BL-061 — campaign-deploy CLI arg parsing + result classification tests.
 *
 * We test the pure exported helpers (parseCliArgs, splitStdinIds,
 * classifyResult) so the CLI's contract is nailed down without having to
 * shell out or spin up a real Prisma client. The full end-to-end execution
 * is covered by the helper test (deploy-campaign.test.ts) plus the manual
 * dry-run run prior to live deploy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the helper + getCampaign BEFORE importing the CLI, so main()'s
// `initiateCampaignDeploy` reference resolves to our mock.
const initiateDeployMock =
  vi.fn<
    (args: {
      campaignId: string;
      adminEmail: string;
      dryRun?: boolean;
      allowPartial?: boolean;
      allowMissingLastName?: boolean;
    }) => Promise<InitiateDeployResult>
  >();
vi.mock("@/lib/campaigns/deploy-campaign", () => ({
  initiateCampaignDeploy: (args: {
    campaignId: string;
    adminEmail: string;
    dryRun?: boolean;
    allowPartial?: boolean;
    allowMissingLastName?: boolean;
  }) => initiateDeployMock(args),
}));

const getCampaignMock = vi.fn();
vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (id: string) => getCampaignMock(id),
}));

import {
  parseCliArgs,
  splitStdinIds,
  classifyResult,
  main,
  DEFAULT_ADMIN_EMAIL,
} from "../../scripts/cli/campaign-deploy";
import type { InitiateDeployResult } from "@/lib/campaigns/deploy-campaign";

// ---------------------------------------------------------------------------
// splitStdinIds
// ---------------------------------------------------------------------------

describe("splitStdinIds", () => {
  it("splits newline-delimited input", () => {
    expect(splitStdinIds("c1\nc2\nc3\n")).toEqual(["c1", "c2", "c3"]);
  });

  it("splits comma-delimited input", () => {
    expect(splitStdinIds("c1,c2,c3")).toEqual(["c1", "c2", "c3"]);
  });

  it("accepts mixed whitespace + commas", () => {
    expect(splitStdinIds("c1 ,\n  c2\t,c3\r\n")).toEqual(["c1", "c2", "c3"]);
  });

  it("returns [] for empty / whitespace-only input", () => {
    expect(splitStdinIds("")).toEqual([]);
    expect(splitStdinIds("   \n\t  ")).toEqual([]);
  });

  it("drops empty tokens from consecutive separators", () => {
    expect(splitStdinIds("c1,,c2\n\nc3")).toEqual(["c1", "c2", "c3"]);
  });
});

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  it("parses --ids CSV with defaults (LIVE mode)", () => {
    const out = parseCliArgs(["--ids=c1,c2,c3"]);
    expect(out).toEqual({
      ids: ["c1", "c2", "c3"],
      dryRun: false,
      allowPartial: false,
      allowMissingLastName: false,
      adminEmail: DEFAULT_ADMIN_EMAIL,
      incident: null,
    });
  });

  it("defaults to LIVE mode (unlike patch-content-approved which defaults to dry-run)", () => {
    const out = parseCliArgs(["--ids=c1"]);
    expect(out.dryRun).toBe(false);
  });

  it("parses --dry-run", () => {
    const out = parseCliArgs(["--ids=c1", "--dry-run"]);
    expect(out.dryRun).toBe(true);
  });

  it("parses --allow-partial", () => {
    const out = parseCliArgs(["--ids=c1", "--allow-partial"]);
    expect(out.allowPartial).toBe(true);
  });

  it("parses --allow-missing-lastname", () => {
    const out = parseCliArgs(["--ids=c1", "--allow-missing-lastname"]);
    expect(out.allowMissingLastName).toBe(true);
  });

  it("parses --admin-email override", () => {
    const out = parseCliArgs([
      "--ids=c1",
      "--admin-email=jonathan@outsignal.ai",
    ]);
    expect(out.adminEmail).toBe("jonathan@outsignal.ai");
  });

  it("parses --incident", () => {
    const out = parseCliArgs(["--ids=c1", "--incident=BL-061"]);
    expect(out.incident).toBe("BL-061");
  });

  it("falls back to stdin IDs when --ids is omitted", () => {
    const out = parseCliArgs([], ["c1", "c2"]);
    expect(out.ids).toEqual(["c1", "c2"]);
  });

  it("deduplicates IDs across --ids flag and stdin (order preserved)", () => {
    const out = parseCliArgs(["--ids=c1,c2"], ["c2", "c3"]);
    expect(out.ids).toEqual(["c1", "c2", "c3"]);
  });

  it("throws when no IDs are supplied at all", () => {
    expect(() => parseCliArgs([])).toThrow(/No campaign IDs/);
  });

  it("throws when --ids is empty and stdin is empty", () => {
    expect(() => parseCliArgs(["--ids="])).toThrow(/No campaign IDs/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseCliArgs(["--ids=c1", "--mystery"])).toThrow(
      /Unknown flag/,
    );
  });

  it("rejects positional arguments (forces unambiguous --ids/stdin sourcing)", () => {
    expect(() => parseCliArgs(["c1-positional"])).toThrow(
      /Unexpected positional argument/,
    );
  });

  it("handles all flags together", () => {
    const out = parseCliArgs([
      "--ids=c1,c2",
      "--dry-run",
      "--admin-email=ops@outsignal.ai",
      "--incident=BL-061",
    ]);
    expect(out).toEqual({
      ids: ["c1", "c2"],
      dryRun: true,
      allowPartial: false,
      allowMissingLastName: false,
      adminEmail: "ops@outsignal.ai",
      incident: "BL-061",
    });
  });

  it("trims whitespace around comma-separated IDs", () => {
    const out = parseCliArgs(["--ids=  c1 , c2  ,c3"]);
    expect(out.ids).toEqual(["c1", "c2", "c3"]);
  });
});

// ---------------------------------------------------------------------------
// classifyResult
// ---------------------------------------------------------------------------

describe("classifyResult", () => {
  it("flattens a live success into a deployed outcome", () => {
    const result: InitiateDeployResult = {
      ok: true,
      dryRun: false,
      deployId: "deploy-1",
      beforeStatus: "approved",
      afterStatus: "deployed",
      channels: ["email"],
      campaignName: "Acme E1",
      workspaceSlug: "acme",
    };

    expect(classifyResult("camp-1", result)).toEqual({
      id: "camp-1",
      workspace: "acme",
      name: "Acme E1",
      beforeStatus: "approved",
      afterStatus: "deployed",
      deployId: "deploy-1",
      verdict: "deployed",
    });
  });

  it("flattens a dry-run success into a would-deploy outcome", () => {
    const result: InitiateDeployResult = {
      ok: true,
      dryRun: true,
      deployId: null,
      beforeStatus: "approved",
      afterStatus: "deployed",
      channels: ["email"],
      campaignName: "Acme E1",
      workspaceSlug: "acme",
    };

    const outcome = classifyResult("camp-1", result);
    expect(outcome.verdict).toBe("would-deploy");
    expect(outcome.deployId).toBeNull();
  });

  it("flattens a failure (with campaign context) into an error outcome", () => {
    const result: InitiateDeployResult = {
      ok: false,
      code: "missing_approvals",
      reason: "Both leads and content must be approved",
      campaignName: "Acme E1",
      workspaceSlug: "acme",
      beforeStatus: "pending_approval",
    };

    expect(classifyResult("camp-1", result)).toEqual({
      id: "camp-1",
      workspace: "acme",
      name: "Acme E1",
      beforeStatus: "pending_approval",
      afterStatus: null,
      deployId: null,
      verdict: "error",
      errorCode: "missing_approvals",
      errorReason: "Both leads and content must be approved",
    });
  });

  it("flattens a not_found failure (no campaign context) into an error outcome", () => {
    const result: InitiateDeployResult = {
      ok: false,
      code: "not_found",
      reason: "Campaign nope not found",
    };

    expect(classifyResult("nope", result)).toEqual({
      id: "nope",
      workspace: null,
      name: null,
      beforeStatus: null,
      afterStatus: null,
      deployId: null,
      verdict: "error",
      errorCode: "not_found",
      errorReason: "Campaign nope not found",
    });
  });
});

// ---------------------------------------------------------------------------
// main() — helper-throw handling (QA Finding A fix)
// ---------------------------------------------------------------------------

describe("main() — helper throw handling", () => {
  const originalArgv = process.argv;
  const originalStdinIsTTY = process.stdin.isTTY;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    initiateDeployMock.mockReset();
    getCampaignMock.mockReset();
    // Neutralize stderr spam during the test.
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(() => true) as any;
    // Force the stdin readers to treat us as TTY so they don't try to drain
    // the real test-runner stdin (which would hang indefinitely).
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
  });

  // Restore globals after every test to avoid leakage.
  const restore = () => {
    process.argv = originalArgv;
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: originalStdinIsTTY,
    });
    stderrSpy.mockRestore();
  };

  it("captures a mid-batch helper throw on the 2nd of 3 IDs: keeps prior success, records synthetic failure with helper_threw + zombie warning, stops early", async () => {
    // 1st ID: success (deployed). 2nd ID: helper throws. 3rd ID: never called.
    initiateDeployMock.mockImplementation(async ({ campaignId, allowPartial, allowMissingLastName }) => {
      if (campaignId === "camp-1") {
        expect(allowPartial).toBe(false);
        expect(allowMissingLastName).toBe(false);
        return {
          ok: true,
          dryRun: false,
          deployId: "deploy-1",
          beforeStatus: "approved",
          afterStatus: "deployed",
          channels: ["email"],
          campaignName: "Acme E1",
          workspaceSlug: "acme",
        };
      }
      if (campaignId === "camp-2") {
        throw new Error(
          "tasks.trigger rejected: upstream Trigger.dev 502 after updateMany",
        );
      }
      throw new Error("should never reach camp-3");
    });

    // Post-verify for camp-1 returns a deployed campaign snapshot.
    getCampaignMock.mockImplementation(async (id: string) =>
      id === "camp-1"
        ? {
            id: "camp-1",
            status: "deployed",
            deployedAt: new Date("2026-04-15T16:00:00.000Z"),
          }
        : null,
    );

    process.argv = [
      "node",
      "campaign-deploy.ts",
      "--ids=camp-1,camp-2,camp-3",
    ];

    let summary;
    // Capture stderr writes BEFORE restore() resets the spy.
    let stderrWrites = "";
    try {
      summary = await main();
      stderrWrites = stderrSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .join("");
    } finally {
      restore();
    }

    expect(initiateDeployMock).toHaveBeenCalledTimes(2);
    expect(initiateDeployMock.mock.calls[0]![0]!.campaignId).toBe("camp-1");
    expect(initiateDeployMock.mock.calls[1]![0]!.campaignId).toBe("camp-2");

    expect(summary.mode).toBe("live");
    expect(summary.total).toBe(3);
    expect(summary.success).toBe(1);
    expect(summary.failure).toBe(1);
    expect(summary.stoppedEarly).toBe(true);

    // Only two rows: success + synthetic failure. camp-3 must NOT appear.
    expect(summary.results).toHaveLength(2);

    // Row 0 — success, with post-verify snapshot attached.
    expect(summary.results[0]!.id).toBe("camp-1");
    expect(summary.results[0]!.verdict).toBe("deployed");
    expect(summary.results[0]!.deployId).toBe("deploy-1");
    expect(summary.results[0]!.verifiedStatus).toBe("deployed");

    // Row 1 — synthetic failure from the catch block.
    const failureRow = summary.results[1]!;
    expect(failureRow.id).toBe("camp-2");
    expect(failureRow.verdict).toBe("error");
    expect(failureRow.errorCode).toBe("helper_threw");
    expect(failureRow.errorReason).toMatch(/tasks\.trigger rejected/);
    expect(failureRow.errorWarning).toMatch(/zombie deploy/i);
    expect(failureRow.errorWarning).toMatch(/campaignDeploy\.findFirst/);

    // camp-3 must be entirely absent from results.
    expect(summary.results.find((r) => r.id === "camp-3")).toBeUndefined();

    // Loud-and-visible stderr warning must have fired with both lines.
    expect(stderrWrites).toMatch(/HELPER THREW for camp-2/);
    expect(stderrWrites).toMatch(/zombie deploy/i);
  });

  it("passes allowPartial and allowMissingLastName through to initiateCampaignDeploy", async () => {
    initiateDeployMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      deployId: "deploy-allow-partial",
      beforeStatus: "approved",
      afterStatus: "deployed",
      channels: ["email"],
      campaignName: "Acme E1",
      workspaceSlug: "acme",
    });
    getCampaignMock.mockResolvedValue({
      id: "camp-1",
      status: "deployed",
      deployedAt: new Date("2026-04-23T10:00:00.000Z"),
    });

    process.argv = [
      "node",
      "campaign-deploy.ts",
      "--ids=camp-1",
      "--allow-partial",
      "--allow-missing-lastname",
    ];

    try {
      await main();
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        configurable: true,
        value: originalStdinIsTTY,
      });
      stderrSpy.mockRestore();
      process.argv = originalArgv;
    }

    expect(initiateDeployMock).toHaveBeenCalledWith({
      campaignId: "camp-1",
      adminEmail: DEFAULT_ADMIN_EMAIL,
      dryRun: false,
      allowPartial: true,
      allowMissingLastName: true,
    });
  });
});
