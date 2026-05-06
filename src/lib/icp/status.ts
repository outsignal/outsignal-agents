export const ICP_SCORING_METHOD = "firecrawl+llm";
export const ICP_NEEDS_WEBSITE_STATUS = "needs_website";
export const ICP_NEEDS_WEBSITE_REASON =
  "NEEDS_WEBSITE: company website content unavailable";
export const ICP_UNSCORABLE_STATUS = "unscorable";

export function isNeedsWebsiteIcpReasoning(
  reasoning: string | null | undefined,
): boolean {
  return reasoning?.startsWith("NEEDS_WEBSITE") ?? false;
}

export function isUnscorableIcpReasoning(
  reasoning: string | null | undefined,
): boolean {
  return reasoning?.startsWith("UNSCORABLE") ?? false;
}
