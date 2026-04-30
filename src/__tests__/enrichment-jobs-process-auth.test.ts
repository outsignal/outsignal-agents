import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/enrichment/queue", () => ({
  processNextChunk: vi.fn(),
}));

vi.mock("@/lib/enrichment/waterfall", () => ({
  createCircuitBreaker: vi.fn(() => ({})),
  enrichCompany: vi.fn(),
  enrichEmail: vi.fn(),
}));

import { processNextChunk } from "@/lib/enrichment/queue";
import { POST } from "@/app/api/enrichment/jobs/process/route";

const originalApiSecret = process.env.API_SECRET;
const originalWorkerApiSecret = process.env.WORKER_API_SECRET;

function postRequest(token?: string) {
  return new Request("https://admin.outsignal.ai/api/enrichment/jobs/process", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("POST /api/enrichment/jobs/process auth", () => {
  afterEach(() => {
    process.env.API_SECRET = originalApiSecret;
    process.env.WORKER_API_SECRET = originalWorkerApiSecret;
    vi.mocked(processNextChunk).mockReset();
  });

  it("accepts WORKER_API_SECRET for worker-driven processing", async () => {
    process.env.API_SECRET = "api-secret";
    process.env.WORKER_API_SECRET = "worker-secret";
    vi.mocked(processNextChunk).mockResolvedValue(null);

    const response = await POST(postRequest("worker-secret"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "no pending jobs" });
    expect(processNextChunk).toHaveBeenCalledTimes(1);
  });

  it("rejects missing or wrong secrets before processing", async () => {
    process.env.API_SECRET = "api-secret";
    process.env.WORKER_API_SECRET = "worker-secret";

    const missing = await POST(postRequest());
    const wrong = await POST(postRequest("wrong-secret"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(processNextChunk).not.toHaveBeenCalled();
  });
});
