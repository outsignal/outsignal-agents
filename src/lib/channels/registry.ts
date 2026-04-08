/**
 * Map-based channel adapter registry.
 *
 * Consumers call getAdapter(channel) to resolve the correct adapter.
 * Adapters self-register via registerAdapter() during app startup.
 */

import type { ChannelType } from "./constants";
import type { ChannelAdapter } from "./types";

const adapters = new Map<ChannelType, ChannelAdapter>();

/** Register an adapter, keyed by its channel property. */
export function registerAdapter(adapter: ChannelAdapter): void {
  adapters.set(adapter.channel, adapter);
}

/**
 * Resolve the adapter for a given channel.
 * Throws if no adapter is registered for that channel.
 */
export function getAdapter(channel: ChannelType): ChannelAdapter {
  const adapter = adapters.get(channel);
  if (!adapter) {
    const registered = Array.from(adapters.keys()).join(", ") || "(none)";
    throw new Error(
      `No adapter registered for channel "${channel}". ` +
        `Registered adapters: [${registered}]. ` +
        `Did you call initAdapters()?`,
    );
  }
  return adapter;
}

/** Return all registered adapters as an array. */
export function getAllAdapters(): ChannelAdapter[] {
  return Array.from(adapters.values());
}

/**
 * Clear all registered adapters.
 * @internal For testing only — do not call in production code.
 */
export function clearAdapters(): void {
  adapters.clear();
}
