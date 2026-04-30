import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const { enqueueJobMock, prismaMock } = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  prismaMock: {
    person: {
      findMany: vi.fn(),
    },
    company: {
      findMany: vi.fn(),
    },
    targetList: {
      findUnique: vi.fn(),
    },
    targetListPerson: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/enrichment/queue", () => ({
  enqueueJob: (...args: unknown[]) => enqueueJobMock(...args),
}));

import { POST } from "@/app/api/enrichment/run/route";

const originalApiSecret = process.env.API_SECRET;
const originalWorkerApiSecret = process.env.WORKER_API_SECRET;

function postRequest(body: unknown, token = "test-secret") {
  return new Request("https://admin.outsignal.ai/api/enrichment/run", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as NextRequest;
}

describe("POST /api/enrichment/run target-list scoping", () => {
  beforeEach(() => {
    process.env.API_SECRET = "test-secret";
    process.env.WORKER_API_SECRET = originalWorkerApiSecret;
    enqueueJobMock.mockResolvedValue("job-1");
  });

  afterEach(() => {
    process.env.API_SECRET = originalApiSecret;
    process.env.WORKER_API_SECRET = originalWorkerApiSecret;
    vi.clearAllMocks();
  });

  it("accepts API_SECRET", async () => {
    prismaMock.person.findMany.mockResolvedValue([{ id: "person-1" }]);

    const response = await POST(
      postRequest({
        entityType: "person",
        workspaceSlug: "1210-solutions",
      }),
    );

    expect(response.status).toBe(200);
    expect(enqueueJobMock).toHaveBeenCalledWith({
      entityType: "person",
      provider: "prospeo",
      entityIds: ["person-1"],
      workspaceSlug: "1210-solutions",
    });
  });

  it("accepts WORKER_API_SECRET for worker-driven enrichment runs", async () => {
    process.env.WORKER_API_SECRET = "worker-secret";
    prismaMock.person.findMany.mockResolvedValue([{ id: "person-1" }]);

    const response = await POST(
      postRequest(
        {
          entityType: "person",
          workspaceSlug: "1210-solutions",
        },
        "worker-secret",
      ),
    );

    expect(response.status).toBe(200);
    expect(enqueueJobMock).toHaveBeenCalledWith({
      entityType: "person",
      provider: "prospeo",
      entityIds: ["person-1"],
      workspaceSlug: "1210-solutions",
    });
  });

  it("rejects missing or wrong secrets", async () => {
    const missing = await POST(
      new Request("https://admin.outsignal.ai/api/enrichment/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType: "person" }),
      }) as NextRequest,
    );
    const wrong = await POST(postRequest({ entityType: "person" }, "wrong-secret"));

    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Unauthorized" });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Unauthorized" });
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("enqueues only people from the requested target list", async () => {
    prismaMock.targetList.findUnique.mockResolvedValue({
      id: "list-1",
      workspaceSlug: "1210-solutions",
    });
    prismaMock.targetListPerson.findMany.mockResolvedValue([
      { personId: "person-1" },
      { personId: "person-2" },
    ]);

    const response = await POST(
      postRequest({
        entityType: "person",
        workspaceSlug: "1210-solutions",
        targetListId: "list-1",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: "job-1", count: 2 });
    expect(prismaMock.targetList.findUnique).toHaveBeenCalledWith({
      where: { id: "list-1" },
      select: { id: true, workspaceSlug: true },
    });
    expect(prismaMock.targetListPerson.findMany).toHaveBeenCalledWith({
      where: { listId: "list-1" },
      select: { personId: true },
      orderBy: { addedAt: "asc" },
      take: 100,
    });
    expect(prismaMock.person.findMany).not.toHaveBeenCalled();
    expect(enqueueJobMock).toHaveBeenCalledWith({
      entityType: "person",
      provider: "prospeo",
      entityIds: ["person-1", "person-2"],
      workspaceSlug: "1210-solutions",
    });
  });

  it("falls back to the existing workspace-wide person query without targetListId", async () => {
    prismaMock.person.findMany.mockResolvedValue([{ id: "person-1" }]);

    const response = await POST(
      postRequest({
        entityType: "person",
        workspaceSlug: "1210-solutions",
        limit: 25,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: "job-1", count: 1 });
    expect(prismaMock.targetList.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.targetListPerson.findMany).not.toHaveBeenCalled();
    expect(prismaMock.person.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { linkedinUrl: { not: null } },
          {
            AND: [
              { firstName: { not: null } },
              { company: { not: null } },
            ],
          },
        ],
        workspaces: { some: { workspace: "1210-solutions" } },
      },
      select: { id: true },
      take: 25,
    });
    expect(enqueueJobMock).toHaveBeenCalledWith({
      entityType: "person",
      provider: "prospeo",
      entityIds: ["person-1"],
      workspaceSlug: "1210-solutions",
    });
  });

  it("applies limit to the target-list slice", async () => {
    prismaMock.targetList.findUnique.mockResolvedValue({
      id: "list-1",
      workspaceSlug: "1210-solutions",
    });
    prismaMock.targetListPerson.findMany.mockResolvedValue([{ personId: "person-1" }]);

    const response = await POST(
      postRequest({
        entityType: "person",
        workspaceSlug: "1210-solutions",
        targetListId: "list-1",
        limit: 1,
      }),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.targetListPerson.findMany).toHaveBeenCalledWith({
      where: { listId: "list-1" },
      select: { personId: true },
      orderBy: { addedAt: "asc" },
      take: 1,
    });
    expect(enqueueJobMock).toHaveBeenCalledWith({
      entityType: "person",
      provider: "prospeo",
      entityIds: ["person-1"],
      workspaceSlug: "1210-solutions",
    });
  });

  it("returns 404 when targetListId does not exist", async () => {
    prismaMock.targetList.findUnique.mockResolvedValue(null);

    const response = await POST(
      postRequest({
        entityType: "person",
        workspaceSlug: "1210-solutions",
        targetListId: "missing-list",
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Target list not found" });
    expect(prismaMock.targetListPerson.findMany).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("returns 403 when targetListId belongs to another workspace", async () => {
    prismaMock.targetList.findUnique.mockResolvedValue({
      id: "list-1",
      workspaceSlug: "other-workspace",
    });

    const response = await POST(
      postRequest({
        entityType: "person",
        workspaceSlug: "1210-solutions",
        targetListId: "list-1",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Target list does not belong to workspace",
    });
    expect(prismaMock.targetListPerson.findMany).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
