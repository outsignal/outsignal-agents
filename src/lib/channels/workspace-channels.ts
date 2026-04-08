/**
 * Workspace channel resolution.
 *
 * Maps the existing Workspace.package field to the set of channels
 * that workspace has enabled. Pure function, no DB queries.
 */

import { WORKSPACE_PACKAGES, CHANNEL_TYPES, type ChannelType } from "./constants";

/**
 * Determine which channels are enabled for a workspace based on its package.
 * Reads the existing Workspace.package field — no schema changes needed.
 */
export function getEnabledChannels(pkg: string): ChannelType[] {
  switch (pkg) {
    case WORKSPACE_PACKAGES.EMAIL:
      return [CHANNEL_TYPES.EMAIL];
    case WORKSPACE_PACKAGES.LINKEDIN:
      return [CHANNEL_TYPES.LINKEDIN];
    case WORKSPACE_PACKAGES.EMAIL_LINKEDIN:
      return [CHANNEL_TYPES.EMAIL, CHANNEL_TYPES.LINKEDIN];
    case WORKSPACE_PACKAGES.CONSULTANCY:
      return []; // consultancy workspaces have no outbound channels
    default:
      return [CHANNEL_TYPES.EMAIL]; // safe default
  }
}
