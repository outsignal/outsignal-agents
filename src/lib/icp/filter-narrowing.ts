import type { IcpProfileSnapshot } from "./resolver";

export type ProfileScopedFilters = {
  jobTitles?: string[];
  industries?: string[];
  locations?: string[];
  companySizes?: string[];
};

function normaliseProfileToken(value: string): string {
  return value.trim().toLowerCase();
}

function narrowFilterValues(
  field: keyof ProfileScopedFilters,
  profileValues: string[] | null | undefined,
  requestValues: string[] | undefined,
): string[] | undefined {
  if (!profileValues || profileValues.length === 0) return requestValues;
  if (!requestValues || requestValues.length === 0) return profileValues;

  const profileSet = new Set(profileValues.map(normaliseProfileToken));
  const outOfScope = requestValues.filter(
    (value) => !profileSet.has(normaliseProfileToken(value)),
  );
  if (outOfScope.length > 0) {
    throw new Error(
      `Request ${field} value(s) outside ICP profile scope: ${outOfScope.join(", ")}`,
    );
  }
  return requestValues;
}

export function narrowIcpProfileFilters<T extends ProfileScopedFilters>(
  filters: T,
  snapshot: IcpProfileSnapshot | null,
): T {
  if (!snapshot) return filters;
  return {
    ...filters,
    jobTitles: narrowFilterValues("jobTitles", snapshot.targetTitles, filters.jobTitles),
    industries: narrowFilterValues("industries", snapshot.industries, filters.industries),
    locations: narrowFilterValues("locations", snapshot.locations, filters.locations),
    companySizes: narrowFilterValues("companySizes", snapshot.companySizes, filters.companySizes),
  };
}
