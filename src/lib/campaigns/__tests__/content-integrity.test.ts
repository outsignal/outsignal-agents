import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    campaign: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}));

import {
  createApprovedContentArtifact,
  hasContentDrifted,
} from "@/lib/campaigns/content-integrity";

describe("campaign content integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a stable hash for equivalent content snapshots", () => {
    const a = createApprovedContentArtifact({
      emailSequence: [
        { position: 1, body: "hello", subjectLine: "Hi" },
      ],
      linkedinSequence: null,
    });
    const b = createApprovedContentArtifact({
      emailSequence: [
        { subjectLine: "Hi", body: "hello", position: 1 },
      ],
      linkedinSequence: null,
    });

    expect(a.approvedContentHash).toBe(b.approvedContentHash);
  });

  it("reports false when the stored hash still matches current sequences", async () => {
    const artifact = createApprovedContentArtifact({
      emailSequence: [
        { position: 1, body: "hello", subjectLine: "Hi" },
      ],
      linkedinSequence: null,
    });

    findUniqueMock.mockResolvedValue({
      approvedContentHash: artifact.approvedContentHash,
      emailSequence: JSON.stringify([
        { position: 1, subjectLine: "Hi", body: "hello" },
      ]),
      linkedinSequence: null,
    });

    await expect(hasContentDrifted("camp-1")).resolves.toBe(false);
  });

  it("reports true when current sequences no longer match the stored hash", async () => {
    const artifact = createApprovedContentArtifact({
      emailSequence: [
        { position: 1, body: "hello", subjectLine: "Hi" },
      ],
      linkedinSequence: null,
    });

    findUniqueMock.mockResolvedValue({
      approvedContentHash: artifact.approvedContentHash,
      emailSequence: JSON.stringify([
        { position: 1, subjectLine: "Hi", body: "rewritten" },
      ]),
      linkedinSequence: null,
    });

    await expect(hasContentDrifted("camp-1")).resolves.toBe(true);
  });

  it("treats a null approvedContentHash as drifted", async () => {
    findUniqueMock.mockResolvedValue({
      approvedContentHash: null,
      emailSequence: JSON.stringify([{ position: 1, body: "hello" }]),
      linkedinSequence: null,
    });

    await expect(hasContentDrifted("camp-1")).resolves.toBe(true);
  });
});
