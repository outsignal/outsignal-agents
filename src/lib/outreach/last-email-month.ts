/**
 * Parse `lastEmailMonth` out of a Campaign.description field.
 *
 * Email and LinkedIn retargeting campaigns store the source email month as
 * `lastEmailMonth:February` (or similar) in Campaign.description so render
 * paths can resolve it without fragile date inference.
 */
export function resolveLastEmailMonth(
  description: string | null | undefined,
): string {
  if (!description) return "";
  const monthMatch = description.match(/lastEmailMonth:(\w+)/);
  return monthMatch ? monthMatch[1] : "";
}
