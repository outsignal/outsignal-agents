import { afterEach, describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/portal-auth";

describe("verifySession", () => {
  const previousSecret = process.env.PORTAL_SESSION_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.PORTAL_SESSION_SECRET;
    } else {
      process.env.PORTAL_SESSION_SECRET = previousSecret;
    }
  });

  it("rejects signed tokens that do not carry a role", () => {
    process.env.PORTAL_SESSION_SECRET = "node-secret";
    const token = signSession({
      workspaceSlug: "ws-1",
      email: "user@example.com",
      role: undefined as never,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    expect(verifySession(token)).toBeNull();
  });
});
