import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const {
  getPortalSessionMock,
  getWorkspaceDetailsMock,
  getCanonicalLinkedInSenderMock,
  senderFindManyMock,
  linkedInDailyUsageFindManyMock,
  linkedInActionGroupByMock,
  linkedInActionCountMock,
  linkedInActionFindManyMock,
  linkedInConnectionCountMock,
  linkedInMessageCountMock,
  linkedInMessageFindManyMock,
  senderHealthEventFindManyMock,
  webhookEventFindManyMock,
  replyFindManyMock,
  campaignCountMock,
} = vi.hoisted(() => ({
  getPortalSessionMock: vi.fn(),
  getWorkspaceDetailsMock: vi.fn(),
  getCanonicalLinkedInSenderMock: vi.fn(),
  senderFindManyMock: vi.fn(),
  linkedInDailyUsageFindManyMock: vi.fn(),
  linkedInActionGroupByMock: vi.fn(),
  linkedInActionCountMock: vi.fn(),
  linkedInActionFindManyMock: vi.fn(),
  linkedInConnectionCountMock: vi.fn(),
  linkedInMessageCountMock: vi.fn(),
  linkedInMessageFindManyMock: vi.fn(),
  senderHealthEventFindManyMock: vi.fn(),
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
  Activity: () => <svg aria-hidden="true" />,
  AlertTriangle: () => <svg aria-hidden="true" />,
  LinkedinIcon: () => <svg aria-hidden="true" />,
  Mail: () => <svg aria-hidden="true" />,
}));

vi.mock("@/lib/portal-session", () => ({
  getPortalSession: (...args: unknown[]) => getPortalSessionMock(...args),
}));

vi.mock("@/lib/workspaces", () => ({
  getWorkspaceDetails: (...args: unknown[]) => getWorkspaceDetailsMock(...args),
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
    linkedInAction: {
      groupBy: (...args: unknown[]) => linkedInActionGroupByMock(...args),
      count: (...args: unknown[]) => linkedInActionCountMock(...args),
      findMany: (...args: unknown[]) => linkedInActionFindManyMock(...args),
    },
    linkedInConnection: {
      count: (...args: unknown[]) => linkedInConnectionCountMock(...args),
    },
    linkedInMessage: {
      count: (...args: unknown[]) => linkedInMessageCountMock(...args),
      findMany: (...args: unknown[]) => linkedInMessageFindManyMock(...args),
    },
    senderHealthEvent: {
      findMany: (...args: unknown[]) => senderHealthEventFindManyMock(...args),
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

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

vi.mock("@/components/ui/empty-state", () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description: string;
    action?: { label?: string };
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {action?.label ? <div>{action.label}</div> : null}
    </div>
  ),
}));

vi.mock("@/components/portal/portal-refresh-button", () => ({
  PortalRefreshButton: () => <button type="button">Refresh</button>,
}));

vi.mock("@/components/portal/relative-timestamp", () => ({
  RelativeTimestamp: () => <span>Updated just now</span>,
}));

vi.mock("@/components/portal/period-selector", () => ({
  PeriodSelector: () => <div>Period selector</div>,
}));

vi.mock("@/components/portal/linkedin-connect-button", () => ({
  PortalConnectButton: ({
    senderName,
    sessionStatus,
  }: {
    senderName: string;
    sessionStatus: string;
  }) => <div>{senderName}:{sessionStatus}</div>,
}));

vi.mock("@/components/portal/health-status-badge", () => ({
  HealthStatusBadge: ({ status }: { status: string }) => <div>{status}</div>,
}));

vi.mock("@/components/portal/warmup-badge", () => ({
  WarmupBadge: ({ warmupDay }: { warmupDay: number }) => <div>Warmup:{warmupDay}</div>,
}));

function primeCommonMocks() {
  getPortalSessionMock.mockResolvedValue({ workspaceSlug: "blanktag" });
  getCanonicalLinkedInSenderMock.mockResolvedValue(null);
  senderFindManyMock.mockResolvedValue([]);
  linkedInDailyUsageFindManyMock.mockResolvedValue([]);
  linkedInActionGroupByMock.mockResolvedValue([]);
  linkedInActionCountMock.mockResolvedValue(0);
  linkedInActionFindManyMock.mockResolvedValue([]);
  linkedInConnectionCountMock.mockResolvedValue(0);
  linkedInMessageCountMock.mockResolvedValue(0);
  linkedInMessageFindManyMock.mockResolvedValue([]);
  senderHealthEventFindManyMock.mockResolvedValue([]);
  webhookEventFindManyMock.mockResolvedValue([]);
  replyFindManyMock.mockResolvedValue([]);
  campaignCountMock.mockResolvedValue(0);
}

describe("Portal dashboard module-aware routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T13:45:00.000Z"));
    primeCommonMocks();
  });

  it("renders LinkedIn-only stats instead of the setup placeholder for workspaces without an email token", async () => {
    getWorkspaceDetailsMock.mockResolvedValue({
      slug: "blanktag",
      name: "BlankTag",
      package: "linkedin",
      enabledModules: JSON.stringify(["linkedin"]),
      apiToken: null,
    });
    senderFindManyMock.mockResolvedValue([
      {
        id: "sender-1",
        name: "James",
        healthStatus: "healthy",
        sessionStatus: "active",
        warmupDay: 12,
        proxyUrl: "http://proxy",
        linkedinProfileUrl: "https://linkedin.com/in/james",
        dailyConnectionLimit: 20,
        dailyMessageLimit: 30,
        dailyProfileViewLimit: 50,
      },
    ]);
    linkedInDailyUsageFindManyMock
      .mockResolvedValueOnce([
        {
          senderId: "sender-1",
          connectionsSent: 11,
          messagesSent: 2,
          profileViews: 7,
        },
      ])
      .mockResolvedValueOnce([
        {
          senderId: "sender-1",
          date: new Date("2026-04-23T00:00:00.000Z"),
          connectionsSent: 11,
          connectionsAccepted: 3,
          messagesSent: 2,
          profileViews: 7,
        },
      ]);
    linkedInActionCountMock
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(7);
    linkedInConnectionCountMock.mockResolvedValue(3);
    linkedInMessageCountMock.mockResolvedValue(1);
    linkedInActionFindManyMock.mockResolvedValue([
      {
        id: "act-1",
        actionType: "connection_request",
        campaignName: "BlankTag LinkedIn",
        completedAt: new Date("2026-04-23T12:00:00.000Z"),
        result: null,
      },
    ]);
    campaignCountMock
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const { default: PortalDashboardPage } = await import("@/app/(portal)/portal/page");

    const markup = renderToStaticMarkup(
      await PortalDashboardPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("BlankTag");
    expect(markup).toContain("LinkedIn Senders");
    expect(markup).toContain("Connections Sent:12");
    expect(markup).not.toContain("Your workspace is being set up");
  });

  it("renders both sections for mixed workspaces", async () => {
    getWorkspaceDetailsMock.mockResolvedValue({
      slug: "lime-recruitment",
      name: "Lime",
      package: "email_linkedin",
      enabledModules: JSON.stringify(["email", "linkedin"]),
      apiToken: null,
    });
    replyFindManyMock
      .mockResolvedValueOnce([
        {
          id: "reply-1",
          senderName: "Prospect",
          senderEmail: "prospect@example.com",
          subject: "Interested",
          bodyText: "hello",
          receivedAt: new Date("2026-04-23T11:00:00.000Z"),
          campaignName: "Lime Email",
          intent: "interested",
        },
      ])
      .mockResolvedValueOnce([
        {
          receivedAt: new Date("2026-04-23T11:00:00.000Z"),
        },
      ]);
    senderFindManyMock.mockResolvedValue([
      {
        id: "sender-1",
        name: "Lucy",
        healthStatus: "healthy",
        sessionStatus: "active",
        warmupDay: 18,
        proxyUrl: "http://proxy",
        linkedinProfileUrl: null,
        dailyConnectionLimit: 20,
        dailyMessageLimit: 30,
        dailyProfileViewLimit: 50,
      },
    ]);
    linkedInDailyUsageFindManyMock.mockResolvedValue([]);
    campaignCountMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const { default: PortalDashboardPage } = await import("@/app/(portal)/portal/page");

    const markup = renderToStaticMarkup(
      await PortalDashboardPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Email Outreach");
    expect(markup).toContain("LinkedIn Outreach");
    expect(markup).toContain("Recent Replies");
    expect(markup).toContain("LinkedIn Senders");
  });

  it("surfaces the reconnect banner when a LinkedIn sender session is expired", async () => {
    getWorkspaceDetailsMock.mockResolvedValue({
      slug: "blanktag",
      name: "BlankTag",
      package: "linkedin",
      enabledModules: JSON.stringify(["linkedin"]),
      apiToken: null,
    });
    senderFindManyMock.mockResolvedValue([
      {
        id: "sender-1",
        name: "James",
        healthStatus: "session_expired",
        sessionStatus: "expired",
        warmupDay: 12,
        proxyUrl: "http://proxy",
        linkedinProfileUrl: null,
        dailyConnectionLimit: 20,
        dailyMessageLimit: 30,
        dailyProfileViewLimit: 50,
      },
    ]);
    campaignCountMock
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);

    const { default: PortalDashboardPage } = await import("@/app/(portal)/portal/page");

    const markup = renderToStaticMarkup(
      await PortalDashboardPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Reconnect your LinkedIn");
    expect(markup).toContain("James:expired");
  });

  it("renders a LinkedIn empty-state CTA instead of zero metrics when no senders exist", async () => {
    getWorkspaceDetailsMock.mockResolvedValue({
      slug: "blanktag",
      name: "BlankTag",
      package: "linkedin",
      enabledModules: JSON.stringify(["linkedin"]),
      apiToken: null,
    });

    const { default: PortalDashboardPage } = await import("@/app/(portal)/portal/page");

    const markup = renderToStaticMarkup(
      await PortalDashboardPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Connect your LinkedIn");
    expect(markup).toContain("Open LinkedIn settings");
    expect(markup).not.toContain("Connections Sent:0");
    expect(markup).not.toContain("LinkedIn Senders");
    expect(markup).not.toContain("LinkedIn worker offline");
  });
});
