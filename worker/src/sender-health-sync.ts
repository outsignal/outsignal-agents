export interface SenderStateOverride {
  healthStatus: string;
  sessionStatus: string;
}

export interface SenderStateSubject {
  id: string;
  healthStatus: string;
  sessionStatus: string;
}

export interface RunnableSender extends SenderStateSubject {
  status: string;
}

export interface SenderHealthSyncTarget {
  id: string;
  name: string;
  sessionStatus: string;
}

export interface SenderHealthSyncApi {
  updateSenderHealth(senderId: string, healthStatus: string): Promise<void>;
}

export const senderStateOverrides = new Map<string, SenderStateOverride>();

export function clearSenderStateOverrides(): void {
  senderStateOverrides.clear();
}

export function getEffectiveSenderState(
  sender: SenderStateSubject,
): SenderStateOverride {
  return senderStateOverrides.get(sender.id) ?? {
    healthStatus: sender.healthStatus,
    sessionStatus: sender.sessionStatus,
  };
}

export function isSenderRunnable(sender: RunnableSender): boolean {
  const effectiveState = getEffectiveSenderState(sender);
  return (
    sender.status === "active" &&
    effectiveState.healthStatus !== "blocked" &&
    effectiveState.healthStatus !== "session_expired" &&
    effectiveState.sessionStatus === "active"
  );
}

export function isSenderRecoverable(sender: RunnableSender): boolean {
  const effectiveState = getEffectiveSenderState(sender);
  return (
    sender.status === "active" &&
    effectiveState.healthStatus === "session_expired"
  );
}

export function isKeepaliveEligible(sender: SenderStateSubject): boolean {
  const effectiveState = getEffectiveSenderState(sender);
  return effectiveState.sessionStatus === "active";
}

function getLocalSessionStatusForHealth(
  sender: Pick<SenderHealthSyncTarget, "sessionStatus">,
  healthStatus: string,
): string {
  if (healthStatus === "session_expired" || healthStatus === "blocked") {
    return "expired";
  }
  if (healthStatus === "healthy") {
    return "active";
  }
  return sender.sessionStatus;
}

export async function syncSenderHealth(
  api: SenderHealthSyncApi,
  sender: SenderHealthSyncTarget,
  healthStatus: string,
  context: string,
): Promise<boolean> {
  try {
    await api.updateSenderHealth(sender.id, healthStatus);
    senderStateOverrides.delete(sender.id);
    return true;
  } catch (error) {
    const override = {
      healthStatus,
      sessionStatus: getLocalSessionStatusForHealth(sender, healthStatus),
    };
    senderStateOverrides.set(sender.id, override);
    console.error(
      `[Worker] Failed to persist sender health for ${sender.name} during ${context} — applying local override ${override.healthStatus}/${override.sessionStatus}`,
      error,
    );
    return false;
  }
}
