import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyEmailRecipients } from "@/lib/notification-guard";

describe("verifyEmailRecipients", () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  afterEach(() => {
    if (originalAdminEmail === undefined) {
      delete process.env.ADMIN_EMAIL;
    } else {
      process.env.ADMIN_EMAIL = originalAdminEmail;
    }
    vi.restoreAllMocks();
  });

  it("filters admin email from client-intent notifications", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const recipients = verifyEmailRecipients(
      ["client@example.com", "admin@example.com"],
      "client",
      "notifyReply",
    );

    expect(recipients).toEqual(["client@example.com"]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("attempted to send client notification to admin email"),
    );
  });

  it("retains non-admin recipients for client-intent notifications", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";

    expect(
      verifyEmailRecipients(["client@example.com"], "client", "notifyReply"),
    ).toEqual(["client@example.com"]);
  });

  it("matches admin email case-insensitively", () => {
    process.env.ADMIN_EMAIL = "admin@outsignal.ai";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const recipients = verifyEmailRecipients(
      ["Admin@Outsignal.ai", "client@example.com"],
      "client",
      "notifyReply",
    );

    expect(recipients).toEqual(["client@example.com"]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("attempted to send client notification to admin email"),
    );
  });
});
