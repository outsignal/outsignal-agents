/**
 * Normalize a company name to consistent title case, with special handling
 * for acronyms, domain suffixes, and hyphenated names.
 */
export function normalizeCompanyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;

  // If 4 chars or fewer and all uppercase, keep as-is (acronyms like DHL, VGS, RTA)
  if (trimmed.length <= 4 && trimmed === trimmed.toUpperCase()) {
    return trimmed;
  }

  // Domain suffixes to preserve as-is
  const domainSuffixes = [".com", ".ai", ".io", ".co"];

  // Check if name ends with a domain suffix
  let suffix = "";
  let base = trimmed;
  for (const ds of domainSuffixes) {
    if (trimmed.toLowerCase().endsWith(ds)) {
      suffix = ds;
      base = trimmed.slice(0, -ds.length);
      break;
    }
  }

  const isAllLower = base === base.toLowerCase();
  const isAllUpper = base === base.toUpperCase();

  // Only convert if all-lowercase or all-uppercase (5+ chars since <=4 uppercase handled above)
  if (!isAllLower && !isAllUpper) {
    // Mixed case: preserve original casing, just return trimmed
    return trimmed;
  }

  // Convert base to title case, preserving casing after hyphens for originally mixed segments
  const words = base.split(/(\s+)/); // split but keep whitespace
  const titleCased = words.map((word) => {
    if (/^\s+$/.test(word)) return word; // preserve whitespace segments

    // Handle hyphenated words: title-case each segment independently
    const parts = word.split(/(-)/);
    return parts
      .map((part) => {
        if (part === "-") return part;
        if (part.length === 0) return part;
        // Preserve special characters like ®
        const firstAlpha = part.search(/[a-zA-Z]/);
        if (firstAlpha === -1) return part; // no alpha chars, keep as-is
        return (
          part.slice(0, firstAlpha) +
          part.charAt(firstAlpha).toUpperCase() +
          part.slice(firstAlpha + 1).toLowerCase()
        );
      })
      .join("");
  });

  return titleCased.join("") + suffix;
}
