import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
}));

const getPortalSessionMock = vi.fn();
vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

const getCampaignMock = vi.fn();
const approveCampaignContentMock = vi.fn();
const approveCampaignLeadsMock = vi.fn();
const rejectCampaignContentMock = vi.fn();
const rejectCampaignLeadsMock = vi.fn();

vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
  approveCampaignContent: (...args: unknown[]) =>
    approveCampaignContentMock(...args),
  approveCampaignLeads: (...args: unknown[]) => approveCampaignLeadsMock(...args),
  rejectCampaignContent: (...args: unknown[]) =>
    rejectCampaignContentMock(...args),
  rejectCampaignLeads: (...args: unknown[]) => rejectCampaignLeadsMock(...args),
}));

vi.mock("@/lib/notifications", () => ({
  notifyApproval: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notify", () => ({
  notify: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/copy-quality", () => ({
  runFullSequenceValidation: vi.fn(() => ({
    hardViolations: [],
    softWarnings: [],
  })),
}));

const params = Promise.resolve({ id: "camp-1" });

function makeRequest(body?: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

const baseCampaign = {
  id: "camp-1",
  name: "Portal Campaign",
  workspaceSlug: "ws-1",
  channels: ["email"],
  copyStrategy: "pvp",
  emailSequence: null,
  linkedinSequence: null,
};

describe("Portal campaign RBAC routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCampaignMock.mockResolvedValue(baseCampaign);
  });

  it("viewer cannot approve content", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import(
      "@/app/api/portal/campaigns/[id]/approve-content/route"
    );

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(approveCampaignContentMock).not.toHaveBeenCalled();
  });

  it("admin can approve content", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "admin@example.com",
      role: "admin",
      exp: Infinity,
    });
    approveCampaignContentMock.mockResolvedValue({
      ...baseCampaign,
      status: "approved",
    });

    const { POST } = await import(
      "@/app/api/portal/campaigns/[id]/approve-content/route"
    );

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(approveCampaignContentMock).toHaveBeenCalledWith("camp-1");
    expect(body.campaign.status).toBe("approved");
  });

  it("viewer cannot approve leads", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import(
      "@/app/api/portal/campaigns/[id]/approve-leads/route"
    );

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(approveCampaignLeadsMock).not.toHaveBeenCalled();
  });

  it("viewer cannot request content changes", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import(
      "@/app/api/portal/campaigns/[id]/request-changes-content/route"
    );

    const res = await POST(makeRequest({ feedback: "Needs work" }), { params });

    expect(res.status).toBe(403);
    expect(rejectCampaignContentMock).not.toHaveBeenCalled();
  });

  it("viewer cannot request lead changes", async () => {
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "viewer@example.com",
      role: "viewer",
      exp: Infinity,
    });

    const { POST } = await import(
      "@/app/api/portal/campaigns/[id]/request-changes-leads/route"
    );

    const res = await POST(makeRequest({ feedback: "Need different leads" }), {
      params,
    });

    expect(res.status).toBe(403);
    expect(rejectCampaignLeadsMock).not.toHaveBeenCalled();
  });
});
