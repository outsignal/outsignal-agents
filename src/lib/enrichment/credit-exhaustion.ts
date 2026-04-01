/**
 * Thrown when a provider returns insufficient credits / funds.
 * Caught by the waterfall and discovery pipeline to PAUSE the entire operation
 * (not skip the provider). Admin is notified via email.
 */
export class CreditExhaustionError extends Error {
  public readonly provider: string;
  public readonly httpStatus: number;

  constructor(provider: string, httpStatus: number, detail?: string) {
    const msg = `Credit exhaustion on ${provider} (HTTP ${httpStatus})${detail ? `: ${detail}` : ""}`;
    super(msg);
    this.name = "CreditExhaustionError";
    this.provider = provider;
    this.httpStatus = httpStatus;
  }
}

/**
 * Check if an error is a credit exhaustion error from any provider.
 * Use this in catch blocks to distinguish credit errors from API errors.
 */
export function isCreditExhaustion(err: unknown): err is CreditExhaustionError {
  return err instanceof CreditExhaustionError;
}
