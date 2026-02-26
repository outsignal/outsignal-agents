/**
 * Provenance recording — writes an audit trail of every enrichment run.
 * Each call creates a new row (not upsert) to maintain full history.
 */
import { prisma } from "@/lib/db";
import type { EntityType, Provider, EnrichmentStatus } from "./types";

export async function recordEnrichment(params: {
  entityId: string;
  entityType: EntityType;
  provider: Provider;
  status?: EnrichmentStatus;
  fieldsWritten?: string[];
  costUsd?: number;
  rawResponse?: unknown;
  errorMessage?: string;
}): Promise<void> {
  await prisma.enrichmentLog.create({
    data: {
      entityId: params.entityId,
      entityType: params.entityType,
      provider: params.provider,
      status: params.status ?? "success",
      fieldsWritten: params.fieldsWritten
        ? JSON.stringify(params.fieldsWritten)
        : null,
      costUsd: params.costUsd ?? null,
      rawResponse: params.rawResponse
        ? JSON.stringify(params.rawResponse)
        : null,
      errorMessage: params.errorMessage ?? null,
    },
  });
}
