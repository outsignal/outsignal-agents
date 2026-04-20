const DESTRUCTIVE_EMAIL_INBOX_ACTIONS = new Set([
  "blacklist_domain",
  "blacklist_email",
  "delete_reply",
  "remove_lead",
]);

export function isDestructiveEmailInboxAction(action: string): boolean {
  return DESTRUCTIVE_EMAIL_INBOX_ACTIONS.has(action);
}
