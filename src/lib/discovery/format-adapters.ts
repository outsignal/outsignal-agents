type ParsedRange = {
  min: number;
  max: number;
};

function parseRange(value: unknown): ParsedRange | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/,/g, "");
  if (!cleaned) return null;

  const bounded = cleaned.match(/^(\d+)\s*-\s*(\d+)$/);
  if (bounded) {
    const min = Number(bounded[1]);
    const max = Number(bounded[2]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
    return { min, max };
  }

  const openEnded = cleaned.match(/^(\d+)\s*\+$/);
  if (openEnded) {
    const min = Number(openEnded[1]);
    return Number.isFinite(min) ? { min, max: Number.POSITIVE_INFINITY } : null;
  }

  const exact = cleaned.match(/^(\d+)$/);
  if (exact) {
    const valueNumber = Number(exact[1]);
    return Number.isFinite(valueNumber)
      ? { min: valueNumber, max: valueNumber }
      : null;
  }

  return null;
}

function overlaps(a: ParsedRange, b: ParsedRange): boolean {
  return a.min <= b.max && a.max >= b.min;
}

function formatRange(range: ParsedRange): string {
  return range.max === Number.POSITIVE_INFINITY
    ? `${range.min}+`
    : `${range.min}-${range.max}`;
}

/**
 * Convert an arbitrary business-friendly company-size range into every vendor
 * bucket that overlaps it. The caller supplies provider-specific bands because
 * Prospeo and Apify do not share the same upper buckets.
 */
export function decomposeRangeToVendorBands(
  requestedRange: unknown,
  vendorBands: string[],
): string[] {
  const requested = parseRange(requestedRange);
  if (!requested) {
    console.warn(
      `[discovery-format] Could not parse company size range "${String(requestedRange)}"; skipping.`,
    );
    return [];
  }

  const candidateBands = vendorBands
    .map((band) => ({ band, range: parseRange(band) }))
    .filter((entry): entry is { band: string; range: ParsedRange } => entry.range !== null)
    .filter((entry) => overlaps(requested, entry.range));

  const hasFiniteBoundaryMatch =
    requested.min === requested.max &&
    candidateBands.some((entry) =>
      entry.range.max !== Number.POSITIVE_INFINITY &&
      requested.min >= entry.range.min &&
      requested.max <= entry.range.max,
    );

  const matchingBands = candidateBands
    .filter((entry) => {
      // Avoid double-counting exact boundary values such as 50000, where a
      // provider may expose both "20001-50000" and "50000+".
      if (
        hasFiniteBoundaryMatch &&
        entry.range.max === Number.POSITIVE_INFINITY &&
        entry.range.min === requested.min
      ) {
        return false;
      }

      // For open-ended requests like "500+", avoid broadening backward into a
      // finite bucket that only touches the lower boundary ("201-500").
      if (
        requested.max === Number.POSITIVE_INFINITY &&
        entry.range.max === requested.min
      ) {
        return false;
      }

      return true;
    })
    .map((entry) => entry.band);

  if (matchingBands.length === 0) {
    console.warn(
      `[discovery-format] Company size range "${String(requestedRange)}" did not overlap any vendor band.`,
    );
    return [];
  }

  const parsedMatches = matchingBands
    .map((band) => parseRange(band))
    .filter((range): range is ParsedRange => range !== null);
  const broadensLower = Math.min(...parsedMatches.map((range) => range.min)) < requested.min;
  const broadensUpper = Math.max(...parsedMatches.map((range) => range.max)) > requested.max;

  if (broadensLower || broadensUpper) {
    console.warn(
      `[discovery-format] Company size range "${formatRange(requested)}" broadens to vendor band(s): ${matchingBands.join(", ")}.`,
    );
  }

  return matchingBands;
}

export function decomposeRangesToVendorBands(
  requestedRanges: string[],
  vendorBands: string[],
): string[] {
  return [
    ...new Set(
      requestedRanges.flatMap((range) =>
        decomposeRangeToVendorBands(range, vendorBands),
      ),
    ),
  ];
}
