function normalizeActionError(error: string): string {
  return error
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const TERMINAL_ACTION_ERRORS = new Set([
  "already_invited",
  "hard_backstop_abort",
  "invalid_profile_url",
  "urn_not_found",
  "note_too_long",
  "missing_shared_secret",
  "profile_not_found_404",
  "failed_to_resolve_profile",
  "failed_to_resolve_sender_profile_urn",
  "failed_to_resolve_memberurn_for_withdrawal",
].map(normalizeActionError));

export function isTerminalActionError(error: string): boolean {
  return TERMINAL_ACTION_ERRORS.has(normalizeActionError(error));
}
