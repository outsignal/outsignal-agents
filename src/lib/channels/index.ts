/**
 * Channel adapter module — barrel export.
 *
 * Import chain: constants <- types <- registry <- adapters <- index (one-way).
 */

export * from "./constants";
export * from "./types";
export {
  registerAdapter,
  getAdapter,
  getAllAdapters,
  clearAdapters,
} from "./registry";
export {
  senderChannelFilter,
  getActiveSendersForChannel,
  countActiveSenders,
} from "./sender-helpers";
export { getEnabledChannels } from "./workspace-channels";
export { LinkedInAdapter } from "./linkedin-adapter";
export { EmailAdapter } from "./email-adapter";
export { buildRef } from "./helpers";

// ---------------------------------------------------------------------------
// Bootstrap — call once before using getAdapter()
// ---------------------------------------------------------------------------

import { registerAdapter } from "./registry";
import { LinkedInAdapter } from "./linkedin-adapter";
import { EmailAdapter } from "./email-adapter";

let initialized = false;

/**
 * Register both concrete adapters in the registry.
 * Safe to call multiple times — only runs once.
 * Phase 73+ consumers call this before getAdapter().
 */
export function initAdapters(): void {
  if (initialized) return;
  registerAdapter(new LinkedInAdapter());
  registerAdapter(new EmailAdapter());
  initialized = true;
}
