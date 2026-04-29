import type { CompanyProviderResult, PersonProviderResult } from "../types";

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getObject(value: unknown): PlainObject | undefined {
  return isPlainObject(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  return strings.length > 0 ? strings : undefined;
}

function bigintFromNumber(value: unknown): bigint | undefined {
  const number = getNumber(value);
  if (number === undefined || number < 0 || !Number.isSafeInteger(number)) return undefined;
  return BigInt(number);
}

function compactRecord(record: Record<string, string | undefined>): Record<string, string> | undefined {
  const entries = Object.entries(record).filter((entry): entry is [string, string] => Boolean(entry[1]));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function contentArray(raw: unknown): unknown[] | null {
  const obj = getObject(raw);
  const content = obj?.content;
  return Array.isArray(content) ? content : null;
}

export function extractAiArkPeople(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const content = contentArray(raw);
  if (content) return content;
  const obj = getObject(raw);
  if (obj?.data !== undefined) {
    return Array.isArray(obj.data) ? obj.data : [obj.data];
  }
  return raw == null ? [] : [raw];
}

export function extractAiArkCompanies(raw: unknown): unknown[] {
  return extractAiArkPeople(raw);
}

export function asAiArkPersonRecord(value: unknown): PlainObject | null {
  return getObject(value) ?? null;
}

export function mapAiArkPersonData(
  record: PlainObject | null,
): Omit<Partial<PersonProviderResult>, "source" | "rawResponse" | "costUsd"> {
  if (!record) return {};

  const profile = getObject(record.profile);
  const link = getObject(record.link);
  const location = getObject(record.location);
  const department = getObject(record.department);
  const company = getObject(record.company);
  const companySummary = getObject(company?.summary);
  const companyLink = getObject(company?.link);
  const profilePicture = getObject(profile?.picture);

  return {
    ...(getString(profile?.first_name) ? { firstName: getString(profile?.first_name) } : {}),
    ...(getString(profile?.last_name) ? { lastName: getString(profile?.last_name) } : {}),
    ...(getString(profile?.title) ? { jobTitle: getString(profile?.title) } : {}),
    ...(getString(profile?.headline) ? { headline: getString(profile?.headline) } : {}),
    ...(getString(profile?.summary) ? { profileSummary: getString(profile?.summary) } : {}),
    ...(getString(profilePicture?.source) ? { profileImageUrl: getString(profilePicture?.source) } : {}),
    ...(getString(link?.linkedin) ? { linkedinUrl: getString(link?.linkedin) } : {}),
    ...(getString(location?.default) ? { location: getString(location?.default) } : {}),
    ...(getString(location?.city) ? { locationCity: getString(location?.city) } : {}),
    ...(getString(location?.state) ? { locationState: getString(location?.state) } : {}),
    ...(getString(location?.country) ? { locationCountry: getString(location?.country) } : {}),
    ...(getString(department?.seniority) ? { seniority: getString(department?.seniority) } : {}),
    ...(getStringArray(department?.departments) ? { departments: getStringArray(department?.departments) } : {}),
    ...(getStringArray(department?.functions) ? { functions: getStringArray(department?.functions) } : {}),
    ...(getStringArray(record.skills) ? { skills: getStringArray(record.skills) } : {}),
    ...(getArray(record.position_groups) ? { jobHistory: getArray(record.position_groups) } : {}),
    ...(getArray(record.educations) ? { education: getArray(record.educations) } : {}),
    ...(getArray(record.certifications) ? { certifications: getArray(record.certifications) } : {}),
    ...(record.languages != null ? { languages: record.languages } : {}),
    ...(getString(companySummary?.name) ? { company: getString(companySummary?.name) } : {}),
    ...(getString(companyLink?.domain) ? { companyDomain: getString(companyLink?.domain) } : {}),
    ...(getString(record.id) ? { providerIds: { aiarkPersonId: getString(record.id)! } } : {}),
  };
}

export function mapAiArkCompanyData(
  record: PlainObject | null,
): { domain?: string; data: Omit<Partial<CompanyProviderResult>, "source" | "rawResponse" | "costUsd"> } {
  const company = getObject(record?.company) ?? record;
  if (!company) return { data: {} };

  const summary = getObject(company.summary);
  const staff = getObject(summary?.staff) ?? getObject(company.staff);
  const link = getObject(company.link);
  const location = getObject(company.location);
  const headquarter = getObject(location?.headquarter);
  const financial = getObject(company.financial);
  const revenueAnnual = getObject(getObject(financial?.revenue)?.annual);
  const aberdeen = getObject(financial?.aberdeen);

  const domain = getString(link?.domain);
  const linkedin = getString(link?.linkedin);
  const socialUrls = compactRecord({
    linkedin,
    twitter: getString(link?.twitter),
    facebook: getString(link?.facebook),
    crunchbase: getString(link?.crunchbase),
  });

  return {
    domain,
    data: {
      ...(getString(summary?.name) ? { name: getString(summary?.name) } : {}),
      ...(getString(summary?.industry) ? { industry: getString(summary?.industry) } : {}),
      ...(getString(summary?.description) ? { description: getString(summary?.description) } : {}),
      ...(getString(summary?.type) ? { companyType: getString(summary?.type) } : {}),
      ...(getNumber(staff?.total) !== undefined ? { headcount: getNumber(staff?.total) } : {}),
      ...(getNumber(summary?.founded_year) !== undefined ? { yearFounded: getNumber(summary?.founded_year) } : {}),
      ...(getString(link?.website) ? { website: getString(link?.website) } : {}),
      ...(linkedin ? { linkedinUrl: linkedin } : {}),
      ...(socialUrls ? { socialUrls } : {}),
      ...(getString(headquarter?.raw_address) ? { hqAddress: getString(headquarter?.raw_address) } : {}),
      ...(getString(headquarter?.raw_address) ? { location: getString(headquarter?.raw_address) } : {}),
      ...(getString(headquarter?.city) ? { hqCity: getString(headquarter?.city) } : {}),
      ...(getString(headquarter?.state) ? { hqState: getString(headquarter?.state) } : {}),
      ...(getString(headquarter?.country) ? { hqCountry: getString(headquarter?.country) } : {}),
      ...(getString(headquarter?.postal_code) ? { hqPostalCode: getString(headquarter?.postal_code) } : {}),
      ...(getArray(location?.locations) ? { officeLocations: getArray(location?.locations) } : {}),
      ...(getString(revenueAnnual?.amount) ? { revenue: getString(revenueAnnual?.amount) } : {}),
      ...(bigintFromNumber(aberdeen?.it_spend) !== undefined ? { itSpend: bigintFromNumber(aberdeen?.it_spend) } : {}),
      ...(getArray(company.technologies) ? { technologies: company.technologies } : {}),
      ...(getStringArray(company.industries) ? { industries: getStringArray(company.industries) } : {}),
      ...(getStringArray(company.naics) ? { naicsCodes: getStringArray(company.naics) } : {}),
      ...(getStringArray(company.keywords) ? { companyKeywords: getStringArray(company.keywords) } : {}),
      ...(getStringArray(company.hashtags) ? { hashtags: getStringArray(company.hashtags) } : {}),
      ...(getString(company.id) ? { providerIds: { aiarkCompanyId: getString(company.id)! } } : {}),
    },
  };
}
