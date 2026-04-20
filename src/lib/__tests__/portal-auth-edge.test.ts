import { afterEach, describe, expect, it } from "vitest";
import { verifySessionEdge } from "@/lib/portal-auth-edge";

async function signSession(raw: Record<string, unknown>, secret: string): Promise<string> {
  const payload = Buffer.from(JSON.stringify(raw)).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}

describe("verifySessionEdge", () => {
  const previousSecret = process.env.PORTAL_SESSION_SECRET;

  afterEach(() => {
    if (previousSecret === undefined) {
      delete process.env.PORTAL_SESSION_SECRET;
    } else {
      process.env.PORTAL_SESSION_SECRET = previousSecret;
    }
  });

  it("rejects signed tokens that do not carry a role", async () => {
    process.env.PORTAL_SESSION_SECRET = "edge-secret";
    const token = await signSession(
      {
        workspaceSlug: "ws-1",
        email: "user@example.com",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "edge-secret",
    );

    expect(await verifySessionEdge(token)).toBeNull();
  });
});
