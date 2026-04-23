export const NEEDS_REVERIFICATION_STATUS = "needs_reverification";

export interface EmailVerificationSnapshot {
  emailVerificationStatus: string | null;
  emailVerificationProvider: string | null;
}

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractEmailVerificationSnapshot(
  enrichmentData: string | null,
): EmailVerificationSnapshot {
  if (!enrichmentData) {
    return {
      emailVerificationStatus: null,
      emailVerificationProvider: null,
    };
  }

  try {
    const data = JSON.parse(enrichmentData);
    if (typeof data !== "object" || data === null) {
      return {
        emailVerificationStatus: null,
        emailVerificationProvider: null,
      };
    }

    const record = data as Record<string, unknown>;
    return {
      emailVerificationStatus:
        typeof record.emailVerificationStatus === "string"
          ? record.emailVerificationStatus
          : null,
      emailVerificationProvider: normalizeProvider(
        record.emailVerificationProvider,
      ),
    };
  } catch {
    return {
      emailVerificationStatus: null,
      emailVerificationProvider: null,
    };
  }
}

export function hasEmailVerificationProvider(
  lead: Pick<EmailVerificationSnapshot, "emailVerificationProvider">,
): boolean {
  return normalizeProvider(lead.emailVerificationProvider) !== null;
}

export function isEmailVerificationTrusted(
  lead: {
    emailVerificationStatus: string | null;
    emailVerificationProvider: string | null;
  },
): boolean {
  return (
    lead.emailVerificationStatus === "valid" &&
    hasEmailVerificationProvider(lead)
  );
}
