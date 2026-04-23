import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, getSenderEmailsMock } = vi.hoisted(() => {
  const prismaMock = {
    workspace: {
      findMany: vi.fn(),
    },
    sender: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  return {
    prismaMock,
    getSenderEmailsMock: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../client", () => ({
  EmailBisonClient: class MockEmailBisonClient {
    getSenderEmails = getSenderEmailsMock;
  },
}));

import { syncSendersForAllWorkspaces } from "@/lib/emailbison/sync-senders";

describe("syncSendersForAllWorkspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      [{ slug: "rise", apiToken: "token-1" }],
    );
    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      [],
    );
    (prismaMock.sender.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 0,
    });
  });

  it("trims display_name when creating new Sender rows from EmailBison", async () => {
    getSenderEmailsMock.mockResolvedValue([
      {
        id: 123,
        email: "charlie@riseheadwearusa.com",
        name: "  Charlie Phillips  ",
      },
    ]);

    await syncSendersForAllWorkspaces();

    expect(prismaMock.sender.create).toHaveBeenCalledWith({
      data: {
        workspaceSlug: "rise",
        name: "Charlie Phillips",
        emailAddress: "charlie@riseheadwearusa.com",
        emailBisonSenderId: 123,
        channel: "email",
        emailSenderName: "Charlie Phillips",
        status: "active",
        firstConnectedAt: expect.any(Date),
      },
    });
  });

  it("trims display_name when updating a matched sender by EmailBison id", async () => {
    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "sender-1",
        name: "Charlie Phillips",
        emailAddress: "charlie@riseheadwearusa.com",
        emailBisonSenderId: 123,
        emailSenderName: "Old Name",
        channel: "email",
        status: "active",
        firstConnectedAt: null,
      },
    ]);

    getSenderEmailsMock.mockResolvedValue([
      {
        id: 123,
        email: "charlie@riseheadwearusa.com",
        name: "  Charlie Phillips  ",
      },
    ]);

    await syncSendersForAllWorkspaces();

    expect(prismaMock.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-1" },
      data: {
        emailAddress: "charlie@riseheadwearusa.com",
        channel: "email",
        emailSenderName: "Charlie Phillips",
        firstConnectedAt: expect.any(Date),
      },
    });
  });

  it("trims display_name when updating a matched sender by email", async () => {
    (prismaMock.sender.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "sender-2",
        name: "Charlie Phillips",
        emailAddress: "charlie@riseheadwearusa.com",
        emailBisonSenderId: null,
        emailSenderName: "Old Name",
        channel: "email",
        status: "active",
        firstConnectedAt: null,
      },
    ]);

    getSenderEmailsMock.mockResolvedValue([
      {
        id: 123,
        email: "charlie@riseheadwearusa.com",
        name: "  Charlie Phillips  ",
      },
    ]);

    await syncSendersForAllWorkspaces();

    expect(prismaMock.sender.update).toHaveBeenCalledWith({
      where: { id: "sender-2" },
      data: {
        emailBisonSenderId: 123,
        channel: "email",
        emailSenderName: "Charlie Phillips",
        firstConnectedAt: expect.any(Date),
      },
    });
  });

  it.each([
    { label: "null", name: null },
    { label: "empty", name: "" },
    { label: "whitespace-only", name: "   " },
  ])(
    "falls back to email when display_name is $label",
    async ({ name }) => {
      getSenderEmailsMock.mockResolvedValue([
        {
          id: 123,
          email: "charlie@riseheadwearusa.com",
          name,
        },
      ]);

      await syncSendersForAllWorkspaces();

      expect(prismaMock.sender.create).toHaveBeenCalledWith({
        data: {
          workspaceSlug: "rise",
          name: "charlie@riseheadwearusa.com",
          emailAddress: "charlie@riseheadwearusa.com",
          emailBisonSenderId: 123,
          channel: "email",
          status: "active",
          firstConnectedAt: expect.any(Date),
        },
      });
    },
  );
});
