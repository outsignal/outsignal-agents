import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  getPortalSessionMock,
  getWorkspaceBySlugMock,
  getEnabledChannelsMock,
  getCanonicalLinkedInSenderMock,
  senderFindManyMock,
  linkedInDailyUsageFindManyMock,
  webhookEventFindManyMock,
  replyFindManyMock,
  campaignCountMock,
} = vi.hoisted(() => ({
  getPortalSessionMock: vi.fn(),
  getWorkspaceBySlugMock: vi.fn(),
  getEnabledChannelsMock: vi.fn(),
  getCanonicalLinkedInSenderMock: vi.fn(),
  senderFindManyMock: vi.fn(),
  linkedInDailyUsageFindManyMock: vi.fn(),
  webhookEventFindManyMock: vi.fn(),
  replyFindManyMock: vi.fn(),
  campaignCountMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("lucide-react", () => ({
  Mail: () => <svg aria-hidden="true" />,
}));

vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

vi.mock("@/lib/workspaces", () => ({
  getWorkspaceBySlug: (...args: unknown[]) => getWorkspaceBySlugMock(...args),
}));

vi.mock("@/lib/channels", () => ({
  getEnabledChannels: (...args: unknown[]) => getEnabledChannelsMock(...args),
}));

vi.mock("@/lib/linkedin/sender", () => ({
  getCanonicalLinkedInSender: (...args: unknown[]) =>
    getCanonicalLinkedInSenderMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    sender: {
      findMany: (...args: unknown[]) => senderFindManyMock(...args),
    },
    linkedInDailyUsage: {
      findMany: (...args: unknown[]) => linkedInDailyUsageFindManyMock(...args),
    },
    webhookEvent: {
      findMany: (...args: unknown[]) => webhookEventFindManyMock(...args),
    },
    reply: {
      findMany: (...args: unknown[]) => replyFindManyMock(...args),
    },
    campaign: {
      count: (...args: unknown[]) => campaignCountMock(...args),
    },
  },
}));

vi.mock("@/components/dashboard/metric-card", () => ({
  MetricCard: ({ label, value }: { label: string; value: string | number }) => (
    <div>{label}:{String(value)}</div>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/portal/portal-refresh-button", () => ({
  PortalRefreshButton: () => <button type="button">Refresh</button>,
}));

vi.mock("@/components/portal/relative-timestamp", () => ({
  RelativeTimestamp: () => <span />,
}));

vi.mock("@/components/portal/period-selector", () => ({
  PeriodSelector: () => <div>Period selector</div>,
}));

describe("Portal dashboard LinkedIn worker status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));

    getPortalSessionMock.mockResolvedValue({ workspaceSlug: "rise" });
    getWorkspaceBySlugMock.mockResolvedValue({
      slug: "rise",
      name: "Rise",
      package: "linkedin",
      apiToken: null,
    });
    getEnabledChannelsMock.mockReturnValue(["linkedin"]);
    getCanonicalLinkedInSenderMock.mockResolvedValue(null);
    senderFindManyMock.mockResolvedValue([]);
    linkedInDailyUsageFindManyMock.mockResolvedValue([]);
    webhookEventFindManyMock.mockResolvedValue([]);
    replyFindManyMock.mockResolvedValue([]);
    campaignCountMock.mockResolvedValue(0);
  });

  it("renders the LinkedIn worker badge as offline when no canonical live sender exists", async () => {
    const { default: PortalDashboardPage } = await import("@/app/(portal)/portal/page");

    const markup = renderToStaticMarkup(
      await PortalDashboardPage({ searchParams: Promise.resolve({}) }),
    );

    expect(getCanonicalLinkedInSenderMock).toHaveBeenCalledWith("rise");
    expect(markup).toContain("LinkedIn Worker Offline");
    expect(markup).not.toContain("LinkedIn Worker Online");
  });
});
