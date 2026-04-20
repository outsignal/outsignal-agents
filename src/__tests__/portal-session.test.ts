import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (...args: unknown[]) => getMock(...args),
  })),
}));

const verifySessionMock = vi.fn();
vi.mock("@/lib/portal-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/portal-auth")>(
    "@/lib/portal-auth",
  );
  return {
    ...actual,
    verifySession: (...args: unknown[]) => verifySessionMock(...args),
  };
});

describe("getPortalSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full verified session including role", async () => {
    getMock.mockReturnValue({ value: "signed-cookie" });
    verifySessionMock.mockReturnValue({
      workspaceSlug: "ws-1",
      email: "admin@example.com",
      role: "admin",
      exp: 9999999999,
    });

    const { getPortalSession } = await import("@/lib/portal-session");
    const session = await getPortalSession();

    expect(session).toEqual({
      workspaceSlug: "ws-1",
      email: "admin@example.com",
      role: "admin",
      exp: 9999999999,
    });
  });

  it("development fallback returns an owner session", async () => {
    getMock.mockReturnValue(undefined);
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "development";

    try {
      const { getPortalSession } = await import("@/lib/portal-session");
      const session = await getPortalSession();

      expect(session.workspaceSlug).toBe("outsignal");
      expect(session.email).toBe("dev@localhost");
      expect(session.role).toBe("owner");
      expect(session.exp).toBe(Infinity);
    } finally {
      env.NODE_ENV = prev;
    }
  });
});
