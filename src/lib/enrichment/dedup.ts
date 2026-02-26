/**
 * Dedup gate — prevents duplicate paid API calls.
 * Returns true if the entity should be enriched (no prior successful run by this provider).
 */
import { prisma } from "@/lib/db";
import type { EntityType, Provider } from "./types";

export async function shouldEnrich(
  entityId: string,
  entityType: EntityType,
  provider: Provider,
): Promise<boolean> {
  const successfulRun = await prisma.enrichmentLog.findFirst({
    where: { entityId, entityType, provider, status: "success" },
    select: { id: true },
  });
  return successfulRun === null;
}
