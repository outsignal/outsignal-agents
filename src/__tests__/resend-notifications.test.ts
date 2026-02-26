import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks – these are available to vi.mock factory functions because
// vi.hoisted() runs before the hoisted vi.mock() calls.
// ---------------------------------------------------------------------------

const { mockSend, mockPostMessage } = vi.hoisted(() => ({
  mockSend: vi.fn().mockResolvedValue({ id: "test-email-id" }),
  mockPostMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock the "resend" npm package. Use a class so `new Resend(key)` works.
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mockSend };
  },
}));

// Mock the Slack module
vi.mock("@/lib/slack", () => ({
  postMessage: mockPostMessage,
}));

// ---------------------------------------------------------------------------
// Imports (must come AFTER vi.mock calls so hoisting works correctly)
// ---------------------------------------------------------------------------
import { prisma } from "@/lib/db";
import {
  sendNotificationEmail,
  sendOnboardingInviteEmail,
} from "@/lib/resend";
import { notifyReply } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const originalEnv = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests – sendNotificationEmail
// ---------------------------------------------------------------------------

describe("sendNotificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  });

  it("returns early and logs a warning when RESEND_API_KEY is not set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await sendNotificationEmail({
      to: ["user@example.com"],
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "RESEND_API_KEY not set, skipping email notification",
    );
    expect(mockSend).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("sends email with correct params when API key is set", async () => {
    setEnv({ RESEND_API_KEY: "re_test_123" });

    await sendNotificationEmail({
      to: ["alice@example.com"],
      subject: "Hello",
      html: "<p>World</p>",
    });

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["alice@example.com"],
        subject: "Hello",
        html: "<p>World</p>",
      }),
    );
  });

  it("uses RESEND_FROM env var when set", async () => {
    setEnv({
      RESEND_API_KEY: "re_test_123",
      RESEND_FROM: "Custom <custom@example.com>",
    });

    await sendNotificationEmail({
      to: ["bob@example.com"],
      subject: "Custom sender",
      html: "<p>test</p>",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Custom <custom@example.com>",
      }),
    );
  });

  it("uses default from address when RESEND_FROM is not set", async () => {
    setEnv({ RESEND_API_KEY: "re_test_123" });
    delete process.env.RESEND_FROM;

    await sendNotificationEmail({
      to: ["carol@example.com"],
      subject: "Default sender",
      html: "<p>test</p>",
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Outsignal <notifications@outsignal.ai>",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Tests – sendOnboardingInviteEmail
// ---------------------------------------------------------------------------

describe("sendOnboardingInviteEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    setEnv({ RESEND_API_KEY: "re_test_123" });
    delete process.env.RESEND_FROM;
  });

  it("calls sendNotificationEmail with the correct subject", async () => {
    await sendOnboardingInviteEmail({
      clientName: "Acme Corp",
      clientEmail: "client@acme.com",
      inviteUrl: "https://app.outsignal.ai/onboard/abc123",
    });

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["client@acme.com"],
        subject: "Complete your onboarding with Outsignal",
      }),
    );
  });

  it("HTML body contains client name and invite URL", async () => {
    await sendOnboardingInviteEmail({
      clientName: "Acme Corp",
      clientEmail: "client@acme.com",
      inviteUrl: "https://app.outsignal.ai/onboard/abc123",
    });

    const sentHtml = mockSend.mock.calls[0][0].html as string;
    expect(sentHtml).toContain("Acme Corp");
    expect(sentHtml).toContain("https://app.outsignal.ai/onboard/abc123");
  });
});

// ---------------------------------------------------------------------------
// Tests – notifyReply
// ---------------------------------------------------------------------------

describe("notifyReply", () => {
  const mockFindUnique = prisma.workspace.findUnique as Mock;

  const defaultParams = {
    workspaceSlug: "acme",
    leadEmail: "lead@example.com",
    senderEmail: "sender@outsignal.ai",
    subject: "Re: Intro",
    bodyPreview: "Thanks for reaching out!",
  };

  const baseWorkspace = {
    id: "ws-1",
    name: "Acme Workspace",
    slug: "acme",
    slackChannelId: null,
    notificationEmails: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    setEnv({ RESEND_API_KEY: "re_test_123" });
    delete process.env.RESEND_FROM;
  });

  it("returns early when workspace is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    await notifyReply(defaultParams);

    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends Slack notification when slackChannelId exists", async () => {
    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      slackChannelId: "C12345",
    });

    await notifyReply(defaultParams);

    expect(mockPostMessage).toHaveBeenCalledOnce();
    expect(mockPostMessage).toHaveBeenCalledWith(
      "C12345",
      `New reply from ${defaultParams.leadEmail}`,
      expect.any(Array),
    );
  });

  it("sends email notification when notificationEmails exists", async () => {
    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      notificationEmails: JSON.stringify(["admin@acme.com", "ops@acme.com"]),
    });

    await notifyReply(defaultParams);

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["admin@acme.com", "ops@acme.com"],
        subject: `[Outsignal] Reply from ${defaultParams.leadEmail} - Acme Workspace`,
      }),
    );
  });

  it("handles Slack error gracefully (catches and logs)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const slackError = new Error("Slack API down");

    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      slackChannelId: "C12345",
    });
    mockPostMessage.mockRejectedValueOnce(slackError);

    // Should not throw
    await notifyReply(defaultParams);

    expect(errorSpy).toHaveBeenCalledWith(
      "Slack notification failed:",
      slackError,
    );

    errorSpy.mockRestore();
  });

  it("handles email error gracefully (catches and logs)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const emailError = new Error("Resend API error");

    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      notificationEmails: JSON.stringify(["admin@acme.com"]),
    });
    mockSend.mockRejectedValueOnce(emailError);

    // Should not throw
    await notifyReply(defaultParams);

    expect(errorSpy).toHaveBeenCalledWith(
      "Email notification failed:",
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("truncates body preview to 300 characters", async () => {
    const longBody = "A".repeat(500);
    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      slackChannelId: "C12345",
    });

    await notifyReply({ ...defaultParams, bodyPreview: longBody });

    // The Slack message blocks should contain the truncated preview
    const slackBlocks = mockPostMessage.mock.calls[0][2];
    const blockText = slackBlocks[0].text.text as string;
    // The preview in the block should be exactly 300 chars of "A"
    expect(blockText).toContain("A".repeat(300));
    expect(blockText).not.toContain("A".repeat(301));
  });

  it('uses "(no body)" when bodyPreview is null', async () => {
    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      slackChannelId: "C12345",
    });

    await notifyReply({ ...defaultParams, bodyPreview: null });

    const slackBlocks = mockPostMessage.mock.calls[0][2];
    const blockText = slackBlocks[0].text.text as string;
    expect(blockText).toContain("(no body)");
  });

  it("skips email when notificationEmails is an empty array", async () => {
    mockFindUnique.mockResolvedValue({
      ...baseWorkspace,
      notificationEmails: JSON.stringify([]),
    });

    await notifyReply(defaultParams);

    expect(mockSend).not.toHaveBeenCalled();
  });
});
