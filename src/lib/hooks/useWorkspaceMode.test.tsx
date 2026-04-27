// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  WorkspaceModeProvider,
  useWorkspaceMode,
  type WorkspaceMode,
  type WorkspaceModeReturn,
} from "./useWorkspaceMode";

function ModeProbe() {
  return (
    <pre data-testid="workspace-mode">
      {JSON.stringify(useWorkspaceMode())}
    </pre>
  );
}

function renderWorkspaceMode(workspacePackage?: WorkspaceMode | null) {
  render(
    <WorkspaceModeProvider workspacePackage={workspacePackage}>
      <ModeProbe />
    </WorkspaceModeProvider>,
  );

  return JSON.parse(
    screen.getByTestId("workspace-mode").textContent ?? "{}",
  ) as WorkspaceModeReturn;
}

afterEach(() => {
  cleanup();
});

describe("useWorkspaceMode", () => {
  it.each([
    [
      "email",
      {
        mode: "email",
        hasEmail: true,
        hasLinkedIn: false,
        isHybrid: false,
        isEmailOnly: true,
        isLinkedInOnly: false,
      },
    ],
    [
      "linkedin",
      {
        mode: "linkedin",
        hasEmail: false,
        hasLinkedIn: true,
        isHybrid: false,
        isEmailOnly: false,
        isLinkedInOnly: true,
      },
    ],
    [
      "email_linkedin",
      {
        mode: "email_linkedin",
        hasEmail: true,
        hasLinkedIn: true,
        isHybrid: true,
        isEmailOnly: false,
        isLinkedInOnly: false,
      },
    ],
    [
      "consultancy",
      {
        mode: "consultancy",
        hasEmail: true,
        hasLinkedIn: true,
        isHybrid: true,
        isEmailOnly: false,
        isLinkedInOnly: false,
      },
    ],
  ] satisfies Array<[WorkspaceMode, WorkspaceModeReturn]>)(
    "returns mode flags for %s",
    (workspacePackage, expected) => {
      expect(renderWorkspaceMode(workspacePackage)).toEqual(expected);
    },
  );

  it("treats consultancy as a provisional hybrid mode", () => {
    const result = renderWorkspaceMode("consultancy");

    expect(result.hasEmail).toBe(true);
    expect(result.hasLinkedIn).toBe(true);
    expect(result.isHybrid).toBe(true);
  });

  it("defaults to email mode when workspace package is undefined", () => {
    expect(renderWorkspaceMode(undefined)).toEqual({
      mode: "email",
      hasEmail: true,
      hasLinkedIn: false,
      isHybrid: false,
      isEmailOnly: true,
      isLinkedInOnly: false,
    });
  });
});
