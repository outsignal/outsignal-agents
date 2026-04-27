// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { WorkspaceModeProvider, type WorkspaceMode } from "@/lib/hooks/useWorkspaceMode";
import { PortalSidebar } from "./portal-sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/portal",
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    className,
    href,
  }: {
    children: ReactNode;
    className?: string;
    href: string;
  }) => (
    <a className={className} href={href}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/brand/outsignal-logo", () => ({
  OutsignalLogo: () => <div data-testid="outsignal-logo" />,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/portal/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <div>Workspace switcher</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const alwaysVisibleItems = [
  "Dashboard",
  "Campaigns",
  "Inbox",
  "Activity",
  "Billing",
  "Support",
];

function renderSidebar(workspacePackage: WorkspaceMode) {
  return render(
    <WorkspaceModeProvider workspacePackage={workspacePackage}>
      <PortalSidebar workspaceSlug="blanktag" workspaceName="BlankTag" />
    </WorkspaceModeProvider>,
  );
}

function expectVisible(labels: string[]) {
  for (const label of labels) {
    expect(screen.queryByText(label)).not.toBeNull();
  }
}

function expectHidden(labels: string[]) {
  for (const label of labels) {
    expect(screen.queryByText(label)).toBeNull();
  }
}

beforeEach(() => {
  const pendingFetch = new Promise<Response>(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => pendingFetch),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PortalSidebar workspace mode navigation", () => {
  it("shows email nav and hides LinkedIn for email-only workspaces", () => {
    renderSidebar("email");

    expectVisible([...alwaysVisibleItems, "Out of Office", "Sender Health"]);
    expectHidden(["LinkedIn"]);
  });

  it("shows LinkedIn nav and hides email-only health items for LinkedIn-only workspaces", () => {
    renderSidebar("linkedin");

    expectVisible([...alwaysVisibleItems, "LinkedIn"]);
    expectHidden(["Out of Office", "Sender Health"]);
  });

  it("keeps the full hybrid sidebar unchanged for email + LinkedIn workspaces", () => {
    renderSidebar("email_linkedin");

    expectVisible([
      ...alwaysVisibleItems,
      "LinkedIn",
      "Out of Office",
      "Sender Health",
    ]);
  });

  it("treats consultancy workspaces as hybrid for sidebar visibility", () => {
    renderSidebar("consultancy");

    expectVisible([
      ...alwaysVisibleItems,
      "LinkedIn",
      "Out of Office",
      "Sender Health",
    ]);
  });
});
