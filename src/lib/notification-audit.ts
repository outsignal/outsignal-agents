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
export async function audited<T>(
  entry: AuditEntry,
  sendFn: () => Promise<T>,
  opts?: AuditOptions,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await sendFn();
    writeAudit({ ...entry, status: "sent", durationMs: Date.now() - start }).catch(
      (err) => auditFallbackLog({ ...entry, status: "sent", durationMs: Date.now() - start }, err),
    );
    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    writeAudit({
      ...entry,
      status: "failed",
      errorMessage,
      durationMs: Date.now() - start,
    }).catch((auditErr) =>
      auditFallbackLog({ ...entry, status: "failed", errorMessage, durationMs: Date.now() - start }, auditErr),
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
    auditFallbackLog({ ...entry, status: "skipped" }, err),
  );
}

/**
 * Structured fallback log when DB audit write fails.
 * Outputs JSON to stderr so observability tools can parse it.
 */
function auditFallbackLog(
  auditData: {
    notificationType: string;
    channel: string;
    recipient: string;
    status: string;
    workspaceSlug?: string;
    durationMs?: number;
    errorMessage?: string;
  },
  dbWriteError: unknown,
): void {
  const fallback = {
    _tag: "notification_audit_fallback",
    timestamp: new Date().toISOString(),
    status: auditData.status,
    notificationType: auditData.notificationType,
    channel: auditData.channel,
    recipient: auditData.recipient,
    workspaceSlug: auditData.workspaceSlug ?? null,
    durationMs: auditData.durationMs ?? null,
    notificationError: auditData.errorMessage ?? null,
    dbWriteError: dbWriteError instanceof Error ? dbWriteError.message : String(dbWriteError),
  };
  console.error("[notification-audit] DB write failed, fallback log:", JSON.stringify(fallback));
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
