import { getEnabledChannels } from "@/lib/channels";
import { parseModules } from "@/lib/workspaces/quota";

export type PortalDashboardMode = "email" | "linkedin" | "combined";

export interface PortalDashboardWorkspaceConfig {
  package?: string | null;
  enabledModules?: string | null;
}

function resolveModuleChannels(
  workspace: PortalDashboardWorkspaceConfig,
): { hasEmail: boolean; hasLinkedIn: boolean } {
  const parsedModules = workspace.enabledModules
    ? parseModules(workspace.enabledModules)
    : [];

  const hasEmailFromModules =
    parsedModules.includes("email") || parsedModules.includes("email-signals");
  const hasLinkedInFromModules =
    parsedModules.includes("linkedin") ||
    parsedModules.includes("linkedin-signals");

  if (hasEmailFromModules || hasLinkedInFromModules) {
    return {
      hasEmail: hasEmailFromModules,
      hasLinkedIn: hasLinkedInFromModules,
    };
  }

  const channels = getEnabledChannels(workspace.package ?? "");
  return {
    hasEmail: channels.includes("email"),
    hasLinkedIn: channels.includes("linkedin"),
  };
}

export function getPortalDashboardChannels(
  workspace: PortalDashboardWorkspaceConfig,
): { hasEmail: boolean; hasLinkedIn: boolean } {
  return resolveModuleChannels(workspace);
}

export function getPortalDashboardMode(
  workspace: PortalDashboardWorkspaceConfig,
): PortalDashboardMode {
  const { hasEmail, hasLinkedIn } = resolveModuleChannels(workspace);

  if (hasEmail && hasLinkedIn) return "combined";
  if (hasLinkedIn) return "linkedin";
  return "email";
}
