import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const redirectMock = vi.fn();
const notFoundMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
  notFound: (...args: unknown[]) => notFoundMock(...args),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("lucide-react", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />;
  return {
    ArrowLeft: Icon,
    Mail: Icon,
    Linkedin: Icon,
    Clock: Icon,
    CalendarDays: Icon,
    CheckCircle2: Icon,
  };
});

const getPortalSessionMock = vi.fn();
vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

const getCampaignMock = vi.fn();
const getCampaignLeadSampleMock = vi.fn();
vi.mock("@/lib/campaigns/operations", () => ({
  getCampaign: (...args: unknown[]) => getCampaignMock(...args),
  getCampaignLeadSample: (...args: unknown[]) => getCampaignLeadSampleMock(...args),
}));

const hasContentDriftedMock = vi.fn();
vi.mock("@/lib/campaigns/content-integrity", () => ({
  hasContentDrifted: (...args: unknown[]) => hasContentDriftedMock(...args),
}));

vi.mock("@/components/portal/campaign-detail-tabs", () => ({
  CampaignDetailTabs: () => <div>tabs</div>,
}));
vi.mock("@/components/portal/campaign-approval-leads", () => ({
  CampaignApprovalLeads: () => <div>approval leads</div>,
}));
vi.mock("@/components/portal/campaign-approval-content", () => ({
  CampaignApprovalContent: () => <div>approval content</div>,
}));
vi.mock("@/components/ui/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const getAdapterMock = vi.fn((_channel?: unknown) => ({
  getMetrics: vi.fn().mockResolvedValue({}),
  getSequenceSteps: vi.fn().mockResolvedValue([]),
  getActions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/channels", () => ({
  initAdapters: vi.fn(),
  getAdapter: (channel: unknown) => getAdapterMock(channel),
}));
vi.mock("@/lib/channels/helpers", () => ({
  buildRef: vi.fn(() => ({})),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    reply: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    webhookEvent: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("portal campaign detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPortalSessionMock.mockResolvedValue({
      workspaceSlug: "ws-1",
      email: "client@example.com",
      role: "admin",
    });
    getCampaignLeadSampleMock.mockResolvedValue({ leads: [], totalCount: 0 });
  });

  it("renders the drift banner when approved content no longer matches", async () => {
    getCampaignMock.mockResolvedValue({
      id: "camp-1",
      name: "Portal Campaign",
      workspaceSlug: "ws-1",
      status: "approved",
      channels: ["email"],
      description: "Launch copy",
      createdAt: new Date("2026-04-20T12:00:00.000Z"),
      updatedAt: new Date("2026-04-23T12:00:00.000Z"),
      targetListId: "tl-1",
      emailSequence: [],
      linkedinSequence: null,
      contentApproved: true,
      contentApprovedAt: new Date("2026-04-22T12:00:00.000Z"),
      contentFeedback: null,
      leadsApproved: true,
      leadsFeedback: null,
      copyStrategy: "pvp",
      emailBisonCampaignId: 99,
      approvedContentHash: "abc123def4567890",
      approvedContentSnapshot: { emailSequence: [], linkedinSequence: null },
    });
    hasContentDriftedMock.mockResolvedValue(true);

    const module = await import("@/app/(portal)/portal/campaigns/[id]/page");
    const html = renderToStaticMarkup(
      await module.default({
        params: Promise.resolve({ id: "camp-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain(
      "Content has been modified since client approval — re-approval needed.",
    );
    expect(html).toContain("Approved content version abc123def456");
  });
});
