/**
 * Channel-aware sender query helpers for Prisma.
 *
 * Centralises the `channel: { in: ['linkedin', 'both'] }` pattern
 * so consumers never need to construct the filter manually.
 *
 * For in-memory filtering, use `senderMatchesChannel()` from constants.ts.
 * These helpers are for Prisma WHERE clauses (different use case).
 */

import { prisma } from "@/lib/db";
import {
  SENDER_CHANNELS,
  SENDER_STATUSES,
  type ChannelType,
} from "./constants";

/**
 * Returns a Prisma `where.channel` clause that matches senders assigned
 * to the target channel OR to "both".
 *
 * Usage: `prisma.sender.findMany({ where: { channel: senderChannelFilter('linkedin') } })`
 */
export function senderChannelFilter(target: ChannelType) {
  return { in: [target, SENDER_CHANNELS.BOTH] as string[] };
}

/**
 * Query active senders that can serve the given channel for a workspace.
 */
export function getActiveSendersForChannel(
  workspaceSlug: string,
  channel: ChannelType,
) {
  return prisma.sender.findMany({
    where: {
      workspaceSlug,
      status: SENDER_STATUSES.ACTIVE,
      channel: senderChannelFilter(channel),
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Count active senders that can serve the given channel for a workspace.
 */
export function countActiveSenders(
  workspaceSlug: string,
  channel: ChannelType,
): Promise<number> {
  return prisma.sender.count({
    where: {
      workspaceSlug,
      status: SENDER_STATUSES.ACTIVE,
      channel: senderChannelFilter(channel),
    },
  });
}
