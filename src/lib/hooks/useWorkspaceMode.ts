"use client";

import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";

export type WorkspaceMode =
  | "email"
  | "linkedin"
  | "email_linkedin"
  | "consultancy";

export interface WorkspaceModeReturn {
  mode: WorkspaceMode;
  hasEmail: boolean;
  hasLinkedIn: boolean;
  isHybrid: boolean;
  isEmailOnly: boolean;
  isLinkedInOnly: boolean;
}

const WorkspaceModeContext = createContext<WorkspaceMode | undefined>(undefined);

function normalizeWorkspaceMode(mode?: string | null): WorkspaceMode {
  if (
    mode === "email" ||
    mode === "linkedin" ||
    mode === "email_linkedin" ||
    mode === "consultancy"
  ) {
    return mode;
  }

  return "email";
}

function getWorkspaceModeFlags(mode: WorkspaceMode): WorkspaceModeReturn {
  if (mode === "consultancy") {
    // Provisional: consultancy mode uses both channels until its design lands.
    return {
      mode,
      hasEmail: true,
      hasLinkedIn: true,
      isHybrid: true,
      isEmailOnly: false,
      isLinkedInOnly: false,
    };
  }

  return {
    mode,
    hasEmail: mode === "email" || mode === "email_linkedin",
    hasLinkedIn: mode === "linkedin" || mode === "email_linkedin",
    isHybrid: mode === "email_linkedin",
    isEmailOnly: mode === "email",
    isLinkedInOnly: mode === "linkedin",
  };
}

export function WorkspaceModeProvider({
  children,
  workspacePackage,
}: {
  children: ReactNode;
  workspacePackage?: string | null;
}) {
  return createElement(
    WorkspaceModeContext.Provider,
    { value: normalizeWorkspaceMode(workspacePackage) },
    children,
  );
}

export function useWorkspaceMode(): WorkspaceModeReturn {
  const mode = useContext(WorkspaceModeContext) ?? "email";
  return getWorkspaceModeFlags(mode);
}
