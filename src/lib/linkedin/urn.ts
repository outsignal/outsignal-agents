export function extractLinkedInProfileId(
  urn: string | null | undefined,
): string | null {
  if (typeof urn !== "string") return null;

  const normalized = urn.trim();
  if (!normalized) return null;

  const acMatch = normalized.match(/\bACoAA[A-Za-z0-9_-]+\b/);
  if (acMatch?.[0]) return acMatch[0];

  const tupleMatch = normalized.match(/\((?:[^,]+,)?([^)]+)\)$/);
  if (tupleMatch?.[1]) return tupleMatch[1].trim();

  const lastSegmentMatch = normalized.match(/:([^:()]+)$/);
  if (lastSegmentMatch?.[1]) return lastSegmentMatch[1].trim();

  return null;
}

export function extractLinkedInMessageId(
  urn: string | null | undefined,
): string | null {
  if (typeof urn !== "string") return null;

  const normalized = urn.trim();
  if (!normalized) return null;

  const tupleMatch = normalized.match(/\((?:[^,]+,)?([^)]+)\)$/);
  if (tupleMatch?.[1]) return tupleMatch[1].trim();

  const lastSegmentMatch = normalized.match(/:([^:()]+)$/);
  if (lastSegmentMatch?.[1]) return lastSegmentMatch[1].trim();

  return null;
}
