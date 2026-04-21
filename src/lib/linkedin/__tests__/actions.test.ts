import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";

const { revalidatePathMock } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: revalidatePathMock,
}));

import { addLinkedInAccount } from "@/lib/linkedin/actions";

describe("addLinkedInAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("trims the sender name before creating the record", async () => {
    (prisma.sender.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "sender-1",
    });

    await addLinkedInAccount("outsignal", "  Jonathan Sprague  ");

    expect(prisma.sender.create).toHaveBeenCalledWith({
      data: {
        workspaceSlug: "outsignal",
        name: "Jonathan Sprague",
        channel: "linkedin",
        status: "setup",
        loginMethod: "credentials",
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/portal/linkedin");
  });
});
