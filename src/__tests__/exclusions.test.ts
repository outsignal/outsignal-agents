/**
 * Tests for src/lib/exclusions.ts utility functions.
 *
 * Tests normalizeDomain, extractDomain, and isExcluded (with mocked Prisma).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/db", () => ({
  prisma: {
    exclusionEntry: {
      findMany: vi.fn(),
    },
    exclusionEmail: {
      findMany: vi.fn(),
    },
  },
}));

import {
  normalizeDomain,
  extractDomain,
  isExcluded,
  getExclusionDomains,
  getExclusionEmails,
  isEmailExcluded,
  invalidateCache,
} from "@/lib/exclusions";
import { prisma } from "@/lib/db";

describe("normalizeDomain", () => {
  it("strips https:// protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
  });

  it("strips http:// protocol", () => {
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips www. prefix", () => {
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("strips both protocol and www", () => {
    expect(normalizeDomain("https://www.example.com")).toBe("example.com");
  });

  it("strips trailing slashes and paths", () => {
    expect(normalizeDomain("example.com/about")).toBe("example.com");
    expect(normalizeDomain("example.com/")).toBe("example.com");
    expect(normalizeDomain("https://www.example.com/path/to/page")).toBe("example.com");
  });

  it("strips port numbers", () => {
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });

  it("lowercases domains", () => {
    expect(normalizeDomain("EXAMPLE.COM")).toBe("example.com");
    expect(normalizeDomain("Example.Co.Uk")).toBe("example.co.uk");
  });

  it("trims whitespace", () => {
    expect(normalizeDomain("  example.com  ")).toBe("example.com");
  });

  it("returns null for domains without a dot", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("nodot")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });

  it("handles complex URLs", () => {
    expect(normalizeDomain("https://www.sub.domain.co.uk/path?q=1")).toBe(
      "sub.domain.co.uk",
    );
  });
});

describe("extractDomain", () => {
  it("extracts domain from a standard email", () => {
    expect(extractDomain("user@example.com")).toBe("example.com");
  });

  it("lowercases the domain", () => {
    expect(extractDomain("User@EXAMPLE.COM")).toBe("example.com");
  });

  it("returns null for strings without @", () => {
    expect(extractDomain("notanemail")).toBeNull();
  });

  it("returns null for @ at end of string", () => {
    expect(extractDomain("user@")).toBeNull();
  });

  it("returns null when domain part has no dot", () => {
    expect(extractDomain("user@localhost")).toBeNull();
  });

  it("handles emails with subdomains", () => {
    expect(extractDomain("user@mail.example.co.uk")).toBe("mail.example.co.uk");
  });

  it("uses the last @ if multiple exist", () => {
    expect(extractDomain("weird@name@example.com")).toBe("example.com");
  });
});

describe("isExcluded", () => {
  beforeEach(() => {
    invalidateCache("test-workspace");
    vi.clearAllMocks();
  });

  it("returns true for an excluded domain", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", domain: "excluded.com", companyName: null, reason: null, createdAt: new Date() },
    ]);

    const result = await isExcluded("test-workspace", "excluded.com");
    expect(result).toBe(true);
  });

  it("returns false for a non-excluded domain", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", domain: "excluded.com", companyName: null, reason: null, createdAt: new Date() },
    ]);

    const result = await isExcluded("test-workspace", "allowed.com");
    expect(result).toBe(false);
  });

  it("normalizes domain before checking", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", domain: "excluded.com", companyName: null, reason: null, createdAt: new Date() },
    ]);

    expect(await isExcluded("test-workspace", "https://www.excluded.com/path")).toBe(true);
    expect(await isExcluded("test-workspace", "EXCLUDED.COM")).toBe(true);
  });

  it("returns false for invalid domains", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", domain: "excluded.com", companyName: null, reason: null, createdAt: new Date() },
    ]);

    expect(await isExcluded("test-workspace", "nodot")).toBe(false);
  });

  it("caches results across calls", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", domain: "cached.com", companyName: null, reason: null, createdAt: new Date() },
    ]);

    await isExcluded("test-workspace", "cached.com");
    await isExcluded("test-workspace", "cached.com");

    // Should only query DB once due to caching
    expect(prisma.exclusionEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it("respects cache invalidation", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([]);

    await isExcluded("test-workspace", "anything.com");
    invalidateCache("test-workspace");
    await isExcluded("test-workspace", "anything.com");

    expect(prisma.exclusionEntry.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("getExclusionDomains", () => {
  beforeEach(() => {
    invalidateCache("test-workspace");
    vi.clearAllMocks();
  });

  it("returns a Set of domains", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", domain: "a.com", companyName: null, reason: null, createdAt: new Date() },
      { id: "2", workspaceSlug: "test-workspace", domain: "b.com", companyName: null, reason: null, createdAt: new Date() },
    ]);

    const domains = await getExclusionDomains("test-workspace");
    expect(domains).toBeInstanceOf(Set);
    expect(domains.size).toBe(2);
    expect(domains.has("a.com")).toBe(true);
    expect(domains.has("b.com")).toBe(true);
  });

  it("returns empty Set when no exclusions exist", async () => {
    vi.mocked(prisma.exclusionEntry.findMany).mockResolvedValue([]);

    const domains = await getExclusionDomains("test-workspace");
    expect(domains.size).toBe(0);
  });
});

describe("getExclusionEmails", () => {
  beforeEach(() => {
    invalidateCache("test-workspace");
    vi.clearAllMocks();
  });

  it("returns a Set of lowercase emails", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", email: "Boss@Example.COM", reason: null, createdAt: new Date() },
      { id: "2", workspaceSlug: "test-workspace", email: "ceo@acme.com", reason: null, createdAt: new Date() },
    ]);

    const emails = await getExclusionEmails("test-workspace");
    expect(emails).toBeInstanceOf(Set);
    expect(emails.size).toBe(2);
    expect(emails.has("boss@example.com")).toBe(true);
    expect(emails.has("ceo@acme.com")).toBe(true);
  });

  it("returns empty Set when no email exclusions exist", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([]);

    const emails = await getExclusionEmails("test-workspace");
    expect(emails.size).toBe(0);
  });

  it("caches results across calls", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", email: "cached@example.com", reason: null, createdAt: new Date() },
    ]);

    await getExclusionEmails("test-workspace");
    await getExclusionEmails("test-workspace");

    expect(prisma.exclusionEmail.findMany).toHaveBeenCalledTimes(1);
  });

  it("respects cache invalidation", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([]);

    await getExclusionEmails("test-workspace");
    invalidateCache("test-workspace");
    await getExclusionEmails("test-workspace");

    expect(prisma.exclusionEmail.findMany).toHaveBeenCalledTimes(2);
  });
});

describe("isEmailExcluded", () => {
  beforeEach(() => {
    invalidateCache("test-workspace");
    vi.clearAllMocks();
  });

  it("returns true for an excluded email", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", email: "blocked@example.com", reason: null, createdAt: new Date() },
    ]);

    expect(await isEmailExcluded("test-workspace", "blocked@example.com")).toBe(true);
  });

  it("returns false for a non-excluded email", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", email: "blocked@example.com", reason: null, createdAt: new Date() },
    ]);

    expect(await isEmailExcluded("test-workspace", "allowed@example.com")).toBe(false);
  });

  it("normalizes email to lowercase before checking", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([
      { id: "1", workspaceSlug: "test-workspace", email: "blocked@example.com", reason: null, createdAt: new Date() },
    ]);

    expect(await isEmailExcluded("test-workspace", "BLOCKED@EXAMPLE.COM")).toBe(true);
    expect(await isEmailExcluded("test-workspace", "  Blocked@Example.com  ")).toBe(true);
  });

  it("returns false for invalid email strings", async () => {
    vi.mocked(prisma.exclusionEmail.findMany).mockResolvedValue([]);

    expect(await isEmailExcluded("test-workspace", "notanemail")).toBe(false);
    expect(await isEmailExcluded("test-workspace", "")).toBe(false);
  });
});
