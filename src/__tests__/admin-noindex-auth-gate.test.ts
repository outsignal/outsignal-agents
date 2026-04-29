import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("admin indexing and auth gate", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ADMIN_PASSWORD = "test-password";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret";
  });

  it("redirects unauthenticated workspace-scoped admin pages instead of returning 200", async () => {
    const { proxy } = await import("../proxy");
    const req = new NextRequest("https://admin.outsignal.ai/workspace/yoopknows/senders");

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://admin.outsignal.ai/login");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("redirects unauthenticated portal pages instead of returning 200", async () => {
    const { proxy } = await import("../proxy");
    const req = new NextRequest("https://portal.outsignal.ai/portal/campaigns");

    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://portal.outsignal.ai/portal/login");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("rejects unauthenticated admin API routes with 401", async () => {
    const { proxy } = await import("../proxy");
    const req = new NextRequest("https://admin.outsignal.ai/api/dashboard/stats");

    const res = await proxy(req);

    expect(res.status).toBe(401);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });
});
