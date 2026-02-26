import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mock setup for @slack/web-api ---

const mockConversationsCreate = vi.fn();
const mockConversationsInvite = vi.fn();
const mockConversationsInviteShared = vi.fn();
const mockUsersLookupByEmail = vi.fn();
const mockChatPostMessage = vi.fn();

vi.mock("@slack/web-api", () => {
  const MockWebClient = vi.fn(function () {
    return {
      conversations: {
        create: mockConversationsCreate,
        invite: mockConversationsInvite,
        inviteShared: mockConversationsInviteShared,
      },
      users: {
        lookupByEmail: mockUsersLookupByEmail,
      },
      chat: {
        postMessage: mockChatPostMessage,
      },
    };
  });

  return { WebClient: MockWebClient };
});

// Import after mocking so the mock is in place when the module loads
import {
  createPrivateChannel,
  lookupUserByEmail,
  inviteToChannel,
  inviteExternalByEmail,
  createChannelWithMembers,
  postMessage,
} from "@/lib/slack";

describe("Slack integration", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // ---------------------------------------------------------------
  // createPrivateChannel
  // ---------------------------------------------------------------
  describe("createPrivateChannel", () => {
    it("returns null when SLACK_BOT_TOKEN is not set", async () => {
      delete process.env.SLACK_BOT_TOKEN;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await createPrivateChannel("test-channel");

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        "SLACK_BOT_TOKEN not set, skipping channel creation"
      );
      expect(mockConversationsCreate).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it("sanitizes channel name to lowercase with special chars replaced", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C123" },
      });

      await createPrivateChannel("My Cool Channel!!!");

      expect(mockConversationsCreate).toHaveBeenCalledWith({
        name: "my-cool-channel",
        is_private: true,
      });
    });

    it("collapses consecutive hyphens and strips leading/trailing hyphens", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C123" },
      });

      await createPrivateChannel("--Hello---World--");

      expect(mockConversationsCreate).toHaveBeenCalledWith({
        name: "hello-world",
        is_private: true,
      });
    });

    it("returns the channel ID on success", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C_NEW_CHANNEL" },
      });

      const result = await createPrivateChannel("sales-deal");

      expect(result).toBe("C_NEW_CHANNEL");
    });

    it("throws when channel creation response has no channel.id", async () => {
      mockConversationsCreate.mockResolvedValue({ channel: {} });

      await expect(createPrivateChannel("bad-channel")).rejects.toThrow(
        "Failed to create Slack channel"
      );
    });

    it("throws when channel creation response has no channel at all", async () => {
      mockConversationsCreate.mockResolvedValue({});

      await expect(createPrivateChannel("bad-channel")).rejects.toThrow(
        "Failed to create Slack channel"
      );
    });

    it("truncates channel name to 80 characters", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C_LONG" },
      });

      const longName = "a".repeat(120);
      await createPrivateChannel(longName);

      const calledName = mockConversationsCreate.mock.calls[0][0].name;
      expect(calledName).toHaveLength(80);
      expect(calledName).toBe("a".repeat(80));
    });
  });

  // ---------------------------------------------------------------
  // lookupUserByEmail
  // ---------------------------------------------------------------
  describe("lookupUserByEmail", () => {
    it("returns null when SLACK_BOT_TOKEN is not set", async () => {
      delete process.env.SLACK_BOT_TOKEN;

      const result = await lookupUserByEmail("user@example.com");

      expect(result).toBeNull();
      expect(mockUsersLookupByEmail).not.toHaveBeenCalled();
    });

    it("returns the user ID on success", async () => {
      mockUsersLookupByEmail.mockResolvedValue({
        user: { id: "U_FOUND" },
      });

      const result = await lookupUserByEmail("alice@example.com");

      expect(result).toBe("U_FOUND");
      expect(mockUsersLookupByEmail).toHaveBeenCalledWith({
        email: "alice@example.com",
      });
    });

    it("returns null when the user object has no id", async () => {
      mockUsersLookupByEmail.mockResolvedValue({ user: {} });

      const result = await lookupUserByEmail("noone@example.com");

      expect(result).toBeNull();
    });

    it("returns null when the API returns users_not_found error", async () => {
      mockUsersLookupByEmail.mockRejectedValue({
        data: { error: "users_not_found" },
      });

      const result = await lookupUserByEmail("ghost@example.com");

      expect(result).toBeNull();
    });

    it("re-throws other errors", async () => {
      const otherError = new Error("network_failure");
      (otherError as unknown as { data: { error: string } }).data = {
        error: "network_failure",
      };
      mockUsersLookupByEmail.mockRejectedValue(otherError);

      await expect(lookupUserByEmail("fail@example.com")).rejects.toThrow(
        "network_failure"
      );
    });
  });

  // ---------------------------------------------------------------
  // inviteToChannel
  // ---------------------------------------------------------------
  describe("inviteToChannel", () => {
    it("does nothing when SLACK_BOT_TOKEN is not set", async () => {
      delete process.env.SLACK_BOT_TOKEN;

      await inviteToChannel("C123", ["U1", "U2"]);

      expect(mockConversationsInvite).not.toHaveBeenCalled();
    });

    it("does nothing when userIds array is empty", async () => {
      await inviteToChannel("C123", []);

      expect(mockConversationsInvite).not.toHaveBeenCalled();
    });

    it("calls conversations.invite with comma-joined user IDs", async () => {
      mockConversationsInvite.mockResolvedValue({ ok: true });

      await inviteToChannel("C_CHAN", ["U1", "U2", "U3"]);

      expect(mockConversationsInvite).toHaveBeenCalledWith({
        channel: "C_CHAN",
        users: "U1,U2,U3",
      });
    });
  });

  // ---------------------------------------------------------------
  // inviteExternalByEmail
  // ---------------------------------------------------------------
  describe("inviteExternalByEmail", () => {
    it("returns false when SLACK_BOT_TOKEN is not set", async () => {
      delete process.env.SLACK_BOT_TOKEN;

      const result = await inviteExternalByEmail("C123", "ext@example.com");

      expect(result).toBe(false);
      expect(mockConversationsInviteShared).not.toHaveBeenCalled();
    });

    it("returns true on success", async () => {
      mockConversationsInviteShared.mockResolvedValue({ ok: true });

      const result = await inviteExternalByEmail("C_EXT", "partner@co.com");

      expect(result).toBe(true);
      expect(mockConversationsInviteShared).toHaveBeenCalledWith({
        channel: "C_EXT",
        emails: ["partner@co.com"],
      });
    });

    it("returns false on not_paid error and logs a warning", async () => {
      mockConversationsInviteShared.mockRejectedValue({
        data: { error: "not_paid" },
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await inviteExternalByEmail("C123", "ext@example.com");

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Slack Connect not available (not_paid)")
      );

      warnSpy.mockRestore();
    });

    it("returns false on missing_scope error and logs a warning", async () => {
      mockConversationsInviteShared.mockRejectedValue({
        data: { error: "missing_scope" },
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await inviteExternalByEmail("C123", "ext@example.com");

      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Slack Connect not available (missing_scope)")
      );

      warnSpy.mockRestore();
    });

    it("returns false on other errors and logs with console.error", async () => {
      const unknownError = new Error("something_went_wrong");
      mockConversationsInviteShared.mockRejectedValue(unknownError);
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await inviteExternalByEmail("C123", "ext@example.com");

      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to send Slack Connect invite to ext@example.com"
        ),
        unknownError
      );

      errorSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------
  // createChannelWithMembers
  // ---------------------------------------------------------------
  describe("createChannelWithMembers", () => {
    it("returns null when channel creation fails", async () => {
      delete process.env.SLACK_BOT_TOKEN;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await createChannelWithMembers("deal-channel", [
        "a@b.com",
      ]);

      expect(result).toBeNull();

      warnSpy.mockRestore();
    });

    it("invites internal users and sends external invites for unknown users", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C_DEAL" },
      });

      mockUsersLookupByEmail
        .mockResolvedValueOnce({ user: { id: "U_INTERNAL" } })
        .mockRejectedValueOnce({ data: { error: "users_not_found" } });

      mockConversationsInvite.mockResolvedValue({ ok: true });
      mockConversationsInviteShared.mockResolvedValue({ ok: true });

      const result = await createChannelWithMembers("deal-channel", [
        "internal@company.com",
        "external@partner.com",
      ]);

      expect(result).toBe("C_DEAL");

      expect(mockConversationsInvite).toHaveBeenCalledWith({
        channel: "C_DEAL",
        users: "U_INTERNAL",
      });

      expect(mockConversationsInviteShared).toHaveBeenCalledWith({
        channel: "C_DEAL",
        emails: ["external@partner.com"],
      });
    });

    it("handles lookup errors gracefully by treating failed lookups as external", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C_ERR" },
      });

      const lookupError = new Error("timeout");
      (lookupError as unknown as { data: { error: string } }).data = {
        error: "timeout",
      };
      mockUsersLookupByEmail.mockRejectedValue(lookupError);

      mockConversationsInviteShared.mockResolvedValue({ ok: true });

      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await createChannelWithMembers("err-channel", [
        "user@example.com",
      ]);

      expect(result).toBe("C_ERR");

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to look up user@example.com"),
        expect.anything()
      );

      expect(mockConversationsInviteShared).toHaveBeenCalledWith({
        channel: "C_ERR",
        emails: ["user@example.com"],
      });

      errorSpy.mockRestore();
    });

    it("handles invite errors gracefully without throwing", async () => {
      mockConversationsCreate.mockResolvedValue({
        channel: { id: "C_INV_ERR" },
      });

      mockUsersLookupByEmail.mockResolvedValue({ user: { id: "U1" } });
      mockConversationsInvite.mockRejectedValue(
        new Error("invite_failed")
      );

      const errorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = await createChannelWithMembers("invite-err", [
        "user@example.com",
      ]);

      expect(result).toBe("C_INV_ERR");
      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to invite users to channel:",
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------
  // postMessage
  // ---------------------------------------------------------------
  describe("postMessage", () => {
    it("does nothing when SLACK_BOT_TOKEN is not set", async () => {
      delete process.env.SLACK_BOT_TOKEN;
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await postMessage("C123", "Hello");

      expect(mockChatPostMessage).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "SLACK_BOT_TOKEN not set, skipping message"
      );

      warnSpy.mockRestore();
    });

    it("posts a message with text only", async () => {
      mockChatPostMessage.mockResolvedValue({ ok: true });

      await postMessage("C_MSG", "Hello world");

      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: "C_MSG",
        text: "Hello world",
        blocks: undefined,
      });
    });

    it("posts a message with text and blocks", async () => {
      mockChatPostMessage.mockResolvedValue({ ok: true });

      const blocks = [
        {
          type: "section" as const,
          text: { type: "mrkdwn" as const, text: "Hello *world*" },
        },
      ];

      await postMessage("C_MSG", "fallback text", blocks);

      expect(mockChatPostMessage).toHaveBeenCalledWith({
        channel: "C_MSG",
        text: "fallback text",
        blocks,
      });
    });
  });
});
