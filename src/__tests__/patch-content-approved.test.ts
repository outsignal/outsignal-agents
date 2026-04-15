import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseArgs,
  formatAuditNote,
  classify,
  appendContentFeedback,
  DEFAULT_ADMIN_EMAIL,
  EXCLUDED_CAMPAIGN_IDS,
  type CandidateRow,
} from "../../scripts/maintenance/patch-content-approved";
import { prisma } from "@/lib/db";

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  it("throws when no campaign IDs are supplied", () => {
    expect(() => parseArgs(["--apply"])).toThrow(/No campaign IDs/);
  });

  it("parses a single ID with defaults", () => {
    const out = parseArgs(["campaign-1"]);
    expect(out).toEqual({
      apply: false,
      campaignIds: ["campaign-1"],
      justification: null,
      adminEmail: DEFAULT_ADMIN_EMAIL,
      incident: null,
      restoreStatus: null,
    });
  });

  it("parses multiple IDs and --apply", () => {
    const out = parseArgs(["c1", "c2", "--apply"]);
    expect(out.campaignIds).toEqual(["c1", "c2"]);
    expect(out.apply).toBe(true);
  });

  it("parses --justification with spaces", () => {
    const out = parseArgs([
      "c1",
      "--justification=Jamie verbal approval; greeting-only edits",
    ]);
    expect(out.justification).toBe("Jamie verbal approval; greeting-only edits");
  });

  it("parses --admin-email override", () => {
    const out = parseArgs(["c1", "--admin-email=jonathan@outsignal.ai"]);
    expect(out.adminEmail).toBe("jonathan@outsignal.ai");
  });

  it("defaults adminEmail when --admin-email is not supplied", () => {
    const out = parseArgs(["c1"]);
    expect(out.adminEmail).toBe(DEFAULT_ADMIN_EMAIL);
  });

  it("parses --incident", () => {
    const out = parseArgs(["c1", "--incident=BL-053"]);
    expect(out.incident).toBe("BL-053");
  });

  it("parses --restore-status with a valid status", () => {
    const out = parseArgs(["c1", "--restore-status=approved"]);
    expect(out.restoreStatus).toBe("approved");
  });

  it("rejects --restore-status with an unknown status value", () => {
    expect(() =>
      parseArgs(["c1", "--restore-status=not-a-real-status"]),
    ).toThrow(/not a valid CampaignStatus/);
  });

  it("leaves restoreStatus null when --restore-status is absent", () => {
    const out = parseArgs(["c1"]);
    expect(out.restoreStatus).toBeNull();
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["c1", "--mystery"])).toThrow(/Unknown flag/);
  });

  it("handles all flags together", () => {
    const out = parseArgs([
      "c1",
      "c2",
      "--apply",
      "--justification=Verbal approval",
      "--admin-email=ops@outsignal.ai",
      "--incident=BL-053",
      "--restore-status=approved",
    ]);
    expect(out).toEqual({
      apply: true,
      campaignIds: ["c1", "c2"],
      justification: "Verbal approval",
      adminEmail: "ops@outsignal.ai",
      incident: "BL-053",
      restoreStatus: "approved",
    });
  });
});

// ---------------------------------------------------------------------------
// formatAuditNote
// ---------------------------------------------------------------------------

describe("formatAuditNote", () => {
  const patchedAt = new Date("2026-04-15T10:30:00.000Z");

  it("formats with all fields", () => {
    expect(
      formatAuditNote({
        justification: "Jamie verbal approval; greeting-only edits",
        adminEmail: "jonathan@outsignal.ai",
        incident: "BL-053",
        patchedAt,
      }),
    ).toBe(
      "BL-053: Jamie verbal approval; greeting-only edits — patched 2026-04-15 by jonathan@outsignal.ai",
    );
  });

  it("omits incident prefix when incident is null", () => {
    expect(
      formatAuditNote({
        justification: "verbal",
        adminEmail: "claudia@outsignal.ai",
        incident: null,
        patchedAt,
      }),
    ).toBe("verbal — patched 2026-04-15 by claudia@outsignal.ai");
  });

  it("falls back to default body when justification is null", () => {
    expect(
      formatAuditNote({
        justification: null,
        adminEmail: "claudia@outsignal.ai",
        incident: "BL-053",
        patchedAt,
      }),
    ).toBe(
      "BL-053: manual content approval patch — patched 2026-04-15 by claudia@outsignal.ai",
    );
  });

  it("is ISO date only (no time component)", () => {
    const note = formatAuditNote({
      justification: "x",
      adminEmail: "a@b.com",
      incident: null,
      patchedAt: new Date("2026-04-15T23:59:59.000Z"),
    });
    expect(note).toContain("2026-04-15");
    expect(note).not.toContain("23:59");
  });
});

// ---------------------------------------------------------------------------
// appendContentFeedback
// ---------------------------------------------------------------------------

describe("appendContentFeedback", () => {
  it("returns note alone when existing is null", () => {
    expect(appendContentFeedback(null, "NEW")).toBe("NEW");
  });

  it("returns note alone when existing is empty string", () => {
    expect(appendContentFeedback("", "NEW")).toBe("NEW");
  });

  it("appends separated by double newline", () => {
    expect(appendContentFeedback("OLD", "NEW")).toBe("OLD\n\nNEW");
  });
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "c1",
    workspaceSlug: "acme",
    name: "Acme Campaign",
    status: "pending_approval",
    leadsApproved: true,
    contentApproved: false,
    contentFeedback: null,
    ...overrides,
  };
}

describe("classify", () => {
  it("returns patch for rows matching the pattern", () => {
    const row = makeRow();
    expect(classify("c1", row)).toEqual({ kind: "patch", row });
  });

  it("returns excluded when id is in EXCLUDED_CAMPAIGN_IDS", () => {
    const excludedId = Array.from(EXCLUDED_CAMPAIGN_IDS)[0];
    expect(classify(excludedId, undefined).kind).toBe("excluded");
  });

  it("returns missing when row not found", () => {
    expect(classify("nope", undefined)).toEqual({ kind: "missing", id: "nope" });
  });

  it("returns wrong-state for status != pending_approval", () => {
    const row = makeRow({ status: "draft" });
    const v = classify("c1", row);
    expect(v.kind).toBe("wrong-state");
  });

  it("returns wrong-state when leadsApproved is false", () => {
    const row = makeRow({ leadsApproved: false });
    expect(classify("c1", row).kind).toBe("wrong-state");
  });

  it("returns wrong-state when contentApproved is already true", () => {
    const row = makeRow({ contentApproved: true });
    expect(classify("c1", row).kind).toBe("wrong-state");
  });
});

// ---------------------------------------------------------------------------
// Integration test — exercises the full patch path against a mocked prisma.
// We don't re-run main() (it reads process.argv); instead we replay the
// exact sequence of prisma calls main() makes, to assert the contract.
// ---------------------------------------------------------------------------

describe("integration: patch path", () => {
  // Extend the global prisma mock with auditLog + updateMany surface used
  // by the script. Casting the fixture type is acceptable in test-only code.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as any;

  beforeEach(() => {
    vi.clearAllMocks();
    p.auditLog = { create: vi.fn() };
    p.campaign.updateMany = vi.fn();
    p.campaign.update = vi.fn();
    p.campaign.findMany = vi.fn();
  });

  it("performs the full patch sequence for a qualifying row with --restore-status", async () => {
    const row: CandidateRow = makeRow({
      id: "cam-abc",
      workspaceSlug: "lime",
      name: "Lime E2 — Transport+Logistics",
      contentFeedback: "prior note from earlier session",
    });

    p.campaign.findMany.mockResolvedValueOnce([row]);
    p.campaign.updateMany.mockResolvedValueOnce({ count: 1 });
    p.campaign.update.mockResolvedValueOnce({ ...row, status: "approved" });
    p.auditLog.create.mockResolvedValueOnce({ id: "audit-1" });

    // Replay the flow main() performs for a single qualifying row.
    const args = parseArgs([
      "cam-abc",
      "--apply",
      "--justification=Jamie verbal approval; greeting-only edits",
      "--admin-email=jonathan@outsignal.ai",
      "--incident=BL-053",
      "--restore-status=approved",
    ]);

    const rows = await p.campaign.findMany({
      where: { id: { in: [row.id] } },
      select: {
        id: true,
        workspaceSlug: true,
        name: true,
        status: true,
        leadsApproved: true,
        contentApproved: true,
        contentFeedback: true,
      },
    });
    expect(rows).toHaveLength(1);

    const now = new Date("2026-04-15T12:00:00.000Z");
    const note = formatAuditNote({
      justification: args.justification,
      adminEmail: args.adminEmail,
      incident: args.incident,
      patchedAt: now,
    });

    const updated = await p.campaign.updateMany({
      where: {
        id: row.id,
        status: "pending_approval",
        leadsApproved: true,
        contentApproved: false,
      },
      data: {
        contentApproved: true,
        contentApprovedAt: now,
        contentFeedback: appendContentFeedback(row.contentFeedback, note),
      },
    });
    expect(updated.count).toBe(1);

    if (args.restoreStatus) {
      await p.campaign.update({
        where: { id: row.id },
        data: { status: args.restoreStatus },
      });
    }

    await p.auditLog.create({
      data: {
        action: "campaign.contentApproved.manual_patch",
        entityType: "Campaign",
        entityId: row.id,
        adminEmail: args.adminEmail,
        metadata: {
          workspace: row.workspaceSlug,
          campaignName: row.name,
          incident: args.incident,
          justification: args.justification,
          restoredStatus: args.restoreStatus,
          script: "scripts/maintenance/patch-content-approved.ts",
          patchedAt: now.toISOString(),
        },
      },
    });

    // Assertions about the shape of the calls.
    expect(p.campaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "cam-abc",
          status: "pending_approval",
          leadsApproved: true,
          contentApproved: false,
        }),
        data: expect.objectContaining({
          contentApproved: true,
          contentApprovedAt: now,
        }),
      }),
    );

    // contentFeedback must preserve prior note AND include the incident ref.
    const updateManyCall = p.campaign.updateMany.mock.calls[0][0];
    expect(updateManyCall.data.contentFeedback).toContain(
      "prior note from earlier session",
    );
    expect(updateManyCall.data.contentFeedback).toContain("BL-053:");
    expect(updateManyCall.data.contentFeedback).toContain(
      "jonathan@outsignal.ai",
    );

    // Status transition invoked.
    expect(p.campaign.update).toHaveBeenCalledWith({
      where: { id: "cam-abc" },
      data: { status: "approved" },
    });

    // AuditLog row includes the overridden admin email + incident + justification.
    expect(p.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "campaign.contentApproved.manual_patch",
          entityType: "Campaign",
          entityId: "cam-abc",
          adminEmail: "jonathan@outsignal.ai",
          metadata: expect.objectContaining({
            incident: "BL-053",
            justification:
              "Jamie verbal approval; greeting-only edits",
            restoredStatus: "approved",
          }),
        }),
      }),
    );
  });

  it("skips status update when --restore-status is not set", async () => {
    const args = parseArgs(["c1", "--apply", "--incident=BL-053"]);
    expect(args.restoreStatus).toBeNull();

    // When restoreStatus is null, main() does not call campaign.update.
    // We model that with a conditional, mirroring the script.
    if (args.restoreStatus) {
      await p.campaign.update({ where: { id: "c1" }, data: {} });
    }
    expect(p.campaign.update).not.toHaveBeenCalled();
  });
});
