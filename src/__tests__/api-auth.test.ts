import { afterEach, describe, expect, it } from "vitest";
import { validateApiSecret } from "@/lib/api-auth";

const originalApiSecret = process.env.API_SECRET;
const originalWorkerApiSecret = process.env.WORKER_API_SECRET;

function requestWithBearer(token?: string) {
  return new Request("https://admin.outsignal.ai/api/enrichment/jobs/process", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("validateApiSecret", () => {
  afterEach(() => {
    process.env.API_SECRET = originalApiSecret;
    process.env.WORKER_API_SECRET = originalWorkerApiSecret;
  });

  it("accepts API_SECRET by default", () => {
    process.env.API_SECRET = "api-secret";

    expect(validateApiSecret(requestWithBearer("api-secret"))).toBe(true);
  });

  it("rejects missing and wrong bearer tokens", () => {
    process.env.API_SECRET = "api-secret";

    expect(validateApiSecret(requestWithBearer())).toBe(false);
    expect(validateApiSecret(requestWithBearer("wrong-secret"))).toBe(false);
  });

  it("accepts WORKER_API_SECRET when the route opts into it", () => {
    process.env.API_SECRET = "api-secret";
    process.env.WORKER_API_SECRET = "worker-secret";

    expect(
      validateApiSecret(requestWithBearer("worker-secret"), [
        "API_SECRET",
        "WORKER_API_SECRET",
      ]),
    ).toBe(true);
  });

  it("does not accept WORKER_API_SECRET unless requested", () => {
    process.env.API_SECRET = "api-secret";
    process.env.WORKER_API_SECRET = "worker-secret";

    expect(validateApiSecret(requestWithBearer("worker-secret"))).toBe(false);
  });
});
