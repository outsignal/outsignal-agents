import { describe, it, expect, vi, beforeEach } from "vitest";

// EmailBison client mock — controlled per-test via `mockSenderEmails`.
// EmailBisonClient is `new`'d inside checkWorkspace, so we must export a
// class (not a vi.fn). The class delegates getSenderEmails() to the
// per-test list.
let mockSenderEmails: Array<{ email: string; status?: string }> = [];

vi.mock("@/lib/emailbison/client", () => {
  class EmailBisonClient {
    async getSenderEmails() {
      return mockSenderEmails;
    }
  }
  return { EmailBisonClient };
});

import { prisma } from "@/lib/db";
import {
  AGE_THRESHOLDS,
  checkAllWorkspaces,
} from "@/lib/inbox-health/monitor";

const mockWorkspaceFindMany = prisma.workspace.findMany as ReturnType<typeof vi.fn>;
const mockSnapshotFindUnique = prisma.inboxStatusSnapshot.findUnique as ReturnType<typeof vi.fn>;
const mockSnapshotUpsert = prisma.inboxStatusSnapshot.upsert as ReturnType<typeof vi.fn>;
const mockSenderFindMany = prisma.sender.findMany as ReturnType<typeof vi.fn>;

const WORKSPACE = {
  slug: "ws",
  name: "Workspace",
  apiToken: "tok",
};

function setupWorkspaceMock() {
  mockWorkspaceFindMany.mockResolvedValue([WORKSPACE]);
  mockSenderFindMany.mockResolvedValue([]); // no Sender rows by default
  mockSnapshotUpsert.mockResolvedValue({});
}

describe("inbox-monitor — legacy snapshot parsing (Blocker 2.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkspaceMock();
  });

  it("uses previous snapshot's checkedAt for legacy string[] entries — preserves true age", async () => {
    // Inbox observed disconnected 14 days ago via legacy snapshot shape
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86_400_000);
    mockSnapshotFindUnique.mockResolvedValue({
      workspaceSlug: "ws",
      statuses: JSON.stringify({ "alice@example.com": "Disconnected" }),
      // legacy string[] shape (pre-age-tracking)
      disconnectedEmails: JSON.stringify(["alice@example.com"]),
      checkedAt: fourteenDaysAgo,
    });
    mockSenderEmails = [{ email: "alice@example.com", status: "Disconnected" }];

    const results = await checkAllWorkspaces();

    expect(results).toHaveLength(1);
    const change = results[0];
    // 14 days >= CRITICAL_MIN_DAYS_INCLUSIVE (7) → critical bucket, not new.
    expect(change.criticalDisconnections).toHaveLength(1);
    expect(change.criticalDisconnections[0].ageDays).toBeGreaterThanOrEqual(14);
    expect(change.newDisconnections).toHaveLength(0);
  });

  it("falls back to now() when previous snapshot has no checkedAt", async () => {
    mockSnapshotFindUnique.mockResolvedValue({
      workspaceSlug: "ws",
      statuses: JSON.stringify({ "bob@example.com": "Disconnected" }),
      disconnectedEmails: JSON.stringify(["bob@example.com"]),
      checkedAt: null,
    });
    mockSenderEmails = [{ email: "bob@example.com", status: "Disconnected" }];

    const results = await checkAllWorkspaces();
    expect(results).toHaveLength(1);
    // ageDays should be 0 (legacy + no prior checkedAt → now())
    const allEntries = [
      ...results[0].newDisconnections,
      ...results[0].recentDisconnections,
    ];
    expect(allEntries.find((e) => e.email === "bob@example.com")?.ageDays).toBe(0);
  });
});

describe("inbox-monitor — bucket boundaries (Finding 2.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkspaceMock();
  });

  // Helper: build a snapshot where each email's firstDisconnectedAt is
  // dialled to `n` days ago, so ageInDays() returns `n` deterministically.
  function snapshotWithAges(ages: Record<string, number>) {
    const persistShape = Object.entries(ages).map(([email, days]) => ({
      email: email.toLowerCase(),
      firstDisconnectedAt: new Date(Date.now() - days * 86_400_000).toISOString(),
    }));
    const statuses: Record<string, string> = {};
    for (const email of Object.keys(ages)) {
      statuses[email.toLowerCase()] = "Disconnected";
    }
    mockSnapshotFindUnique.mockResolvedValue({
      workspaceSlug: "ws",
      statuses: JSON.stringify(statuses),
      disconnectedEmails: JSON.stringify(persistShape),
      checkedAt: new Date(),
    });
    mockSenderEmails = Object.keys(ages).map((email) => ({
      email,
      status: "Disconnected",
    }));
  }

  it("ageDays=1 → recent (transitional, prior status was disconnected)", async () => {
    snapshotWithAges({ "x@a.com": 1 });
    const change = (await checkAllWorkspaces())[0];
    // Prior status was "Disconnected" so it falls into recent (not new).
    expect(change.recentDisconnections.find((e) => e.email === "x@a.com")).toBeDefined();
    expect(change.newDisconnections.find((e) => e.email === "x@a.com")).toBeUndefined();
  });

  it("ageDays=3 → persistent", async () => {
    snapshotWithAges({ "x@a.com": 3 });
    const change = (await checkAllWorkspaces())[0];
    expect(change.persistentDisconnections.find((e) => e.email === "x@a.com")).toBeDefined();
  });

  it("ageDays=7 → critical (boundary fix — was persistent before)", async () => {
    snapshotWithAges({ "x@a.com": 7 });
    const change = (await checkAllWorkspaces())[0];
    expect(change.criticalDisconnections.find((e) => e.email === "x@a.com")).toBeDefined();
    expect(change.persistentDisconnections.find((e) => e.email === "x@a.com")).toBeUndefined();
  });

  it("ageDays=8 → critical", async () => {
    snapshotWithAges({ "x@a.com": 8 });
    const change = (await checkAllWorkspaces())[0];
    expect(change.criticalDisconnections.find((e) => e.email === "x@a.com")).toBeDefined();
  });
});

describe("inbox-monitor — neverConnected precedence (Finding 2.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkspaceMock();
  });

  it("never-authenticated sender goes to staleProvisioning regardless of age", async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000);
    mockSenderFindMany.mockResolvedValue([
      {
        emailAddress: "stale@example.com",
        sessionStatus: "not_setup",
        sessionConnectedAt: null,
        lastActiveAt: null,
        createdAt: tenDaysAgo,
      },
    ]);
    mockSnapshotFindUnique.mockResolvedValue({
      workspaceSlug: "ws",
      statuses: JSON.stringify({ "stale@example.com": "Disconnected" }),
      disconnectedEmails: JSON.stringify([
        { email: "stale@example.com", firstDisconnectedAt: tenDaysAgo.toISOString() },
      ]),
      checkedAt: new Date(),
    });
    mockSenderEmails = [{ email: "stale@example.com", status: "Disconnected" }];

    const change = (await checkAllWorkspaces())[0];
    // Even though ageDays=10 (would otherwise be critical), neverConnected
    // takes precedence so it must land in staleProvisioning ONLY.
    expect(change.staleProvisioning.find((e) => e.email === "stale@example.com")).toBeDefined();
    expect(change.criticalDisconnections.find((e) => e.email === "stale@example.com")).toBeUndefined();
    expect(change.persistentDisconnections.find((e) => e.email === "stale@example.com")).toBeUndefined();
  });
});

describe("inbox-monitor — email case normalization (Finding 2.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkspaceMock();
  });

  it("matches mixed-case EmailBison response against lowercase snapshot key", async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86_400_000);
    mockSnapshotFindUnique.mockResolvedValue({
      workspaceSlug: "ws",
      statuses: JSON.stringify({ "user@example.com": "Disconnected" }),
      disconnectedEmails: JSON.stringify([
        { email: "user@example.com", firstDisconnectedAt: fiveDaysAgo.toISOString() },
      ]),
      checkedAt: new Date(),
    });
    // EmailBison returns mixed-case
    mockSenderEmails = [{ email: "User@Example.COM", status: "Disconnected" }];

    const change = (await checkAllWorkspaces())[0];
    // Because we now lowercase before lookup, this should match the
    // existing 5-day-old entry and land in persistent — not get
    // re-bucketed as new.
    expect(change.persistentDisconnections).toHaveLength(1);
    expect(change.persistentDisconnections[0].email).toBe("user@example.com");
    expect(change.newDisconnections).toHaveLength(0);
  });

  it("AGE_THRESHOLDS no longer exposes dead PERSISTENT_MAX_DAYS", () => {
    expect("PERSISTENT_MAX_DAYS" in AGE_THRESHOLDS).toBe(false);
    expect(AGE_THRESHOLDS.CRITICAL_MIN_DAYS_INCLUSIVE).toBe(7);
  });
});
