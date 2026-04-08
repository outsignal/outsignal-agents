/**
 * Channel adapter module — barrel export.
 *
 * Import chain: constants <- types <- registry <- index (one-way).
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
