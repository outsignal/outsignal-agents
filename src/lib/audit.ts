import { prisma } from "@/lib/db";

interface AuditLogParams {
  action: string;       // e.g. "campaign.deploy", "client.delete"
  entityType: string;   // e.g. "Campaign", "Client", "Sender", "Invoice"
  entityId: string;     // ID of the affected entity
  adminEmail: string;   // Email of the admin who performed the action
  metadata?: Record<string, unknown>; // Optional extra context
}

/**
 * Fire-and-forget audit log writer.
 *
 * Usage in route handlers:
 *   auditLog({ action: "campaign.deploy", entityType: "Campaign", entityId: id, adminEmail: session.email });
 *
 * Do NOT await this in route handlers — it runs in the background and logs errors to console.
 */
export function auditLog(params: AuditLogParams): void {
  prisma.auditLog
    .create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        adminEmail: params.adminEmail,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: (params.metadata ?? undefined) as any,
      },
    })
    .catch(console.error);
}
