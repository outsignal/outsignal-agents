import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

interface AuditEntry {
  notificationType: string;
  channel: "slack" | "email";
  recipient: string;
  workspaceSlug?: string;
  metadata?: Record<string, unknown>;
}

interface AuditOptions {
  /** Set true when wrapping inside notify.ts to prevent infinite recursion */
  skipOpsAlert?: boolean;
}

/**
 * Wrap a notification send call with audit logging.
 * On success: writes a "sent" audit row (fire-and-forget).
 * On failure: writes a "failed" audit row + fires ops Slack alert, then re-throws.
 */
export async function audited(
  entry: AuditEntry,
  sendFn: () => Promise<void>,
  opts?: AuditOptions,
): Promise<void> {
  const start = Date.now();
  try {
    await sendFn();
    writeAudit({ ...entry, status: "sent", durationMs: Date.now() - start }).catch(
      (err) => console.error("[notification-audit] Failed to write audit log:", err),
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    writeAudit({
      ...entry,
      status: "failed",
      errorMessage,
      durationMs: Date.now() - start,
    }).catch((auditErr) =>
      console.error("[notification-audit] Failed to write failure audit:", auditErr),
    );
    if (!opts?.skipOpsAlert) {
      alertOpsOnFailure(entry, errorMessage).catch((alertErr) =>
        console.error("[notification-audit] Failed to alert ops:", alertErr),
      );
    }
    throw err;
  }
}

/**
 * Record a "skipped" audit entry (e.g. missing API key, no recipients).
 */
export function auditSkipped(entry: AuditEntry): void {
  writeAudit({ ...entry, status: "skipped" }).catch((err) =>
    console.error("[notification-audit] Failed to write skipped audit:", err),
  );
}

async function writeAudit(data: {
  notificationType: string;
  channel: string;
  recipient: string;
  status: string;
  errorMessage?: string;
  workspaceSlug?: string;
  metadata?: Record<string, unknown>;
  durationMs?: number;
}): Promise<void> {
  await prisma.notificationAuditLog.create({
    data: {
      notificationType: data.notificationType,
      channel: data.channel,
      recipient: data.recipient,
      status: data.status,
      errorMessage: data.errorMessage ?? null,
      workspaceSlug: data.workspaceSlug ?? null,
      metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      durationMs: data.durationMs ?? null,
    },
  });
}

async function alertOpsOnFailure(
  entry: AuditEntry,
  errorMessage: string,
): Promise<void> {
  await notify({
    type: "error",
    severity: "error",
    title: `Notification failed: ${entry.notificationType} (${entry.channel})`,
    message: `Recipient: ${entry.recipient}\nError: ${errorMessage}`,
    workspaceSlug: entry.workspaceSlug,
    metadata: entry.metadata,
  });
}
