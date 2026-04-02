/**
 * Job title expansion utility for discovery searches.
 *
 * Expands exact job titles into common variations so the Leads agent
 * finds more ICP-matching people across search platforms.
 *
 * Pure function — no API calls, no LLM, no external deps.
 */

// ---------------------------------------------------------------------------
// 1. Abbreviation ↔ Full form (bidirectional)
// ---------------------------------------------------------------------------

const ABBREVIATION_MAP: Record<string, string> = {
  ceo: "Chief Executive Officer",
  cfo: "Chief Financial Officer",
  cmo: "Chief Marketing Officer",
  cto: "Chief Technology Officer",
  coo: "Chief Operating Officer",
  cro: "Chief Revenue Officer",
  cpo: "Chief Product Officer",
  vp: "Vice President",
  md: "Managing Director",
};

// Build reverse map: full form → abbreviation
const FULL_FORM_MAP: Record<string, string> = {};
for (const [abbr, full] of Object.entries(ABBREVIATION_MAP)) {
  FULL_FORM_MAP[full.toLowerCase()] = abbr.toUpperCase();
}

// ---------------------------------------------------------------------------
// 2. Department synonyms
// ---------------------------------------------------------------------------

const DEPARTMENT_SYNONYM_GROUPS: string[][] = [
  ["Marketing", "Growth"],
  ["Digital", "Online"],
  ["Digital Marketing", "Performance Marketing"],
  ["Sales", "Business Development"],
  ["Engineering", "Technology"],
  ["HR", "Human Resources", "People"],
  ["Finance", "Accounting"],
];

/**
 * For a given department string, return all its synonyms (excluding itself).
 * Matching is case-insensitive; returned values use the casing from the map.
 */
function getDepartmentSynonyms(dept: string): string[] {
  const lower = dept.toLowerCase();
  const synonyms: string[] = [];

  for (const group of DEPARTMENT_SYNONYM_GROUPS) {
    const match = group.find((g) => g.toLowerCase() === lower);
    if (match) {
      for (const g of group) {
        if (g.toLowerCase() !== lower) {
          synonyms.push(g);
        }
      }
    }
  }

  return synonyms;
}

/**
 * Apply department synonym substitution to a title.
 * Replaces each occurrence of a known department with its synonyms,
 * producing new title variants.
 *
 * Longer department names are checked first so "Digital Marketing"
 * matches before "Digital" or "Marketing" individually.
 */
function applyDepartmentSynonyms(title: string): string[] {
  const results: string[] = [];

  // Sort groups by longest member first so multi-word departments match first
  const sortedGroups = DEPARTMENT_SYNONYM_GROUPS
    .flatMap((group) => group.map((dept) => ({ dept, group })))
    .sort((a, b) => b.dept.length - a.dept.length);

  for (const { dept, group } of sortedGroups) {
    const idx = title.toLowerCase().indexOf(dept.toLowerCase());
    if (idx !== -1) {
      const before = title.slice(0, idx);
      const after = title.slice(idx + dept.length);
      for (const synonym of group) {
        if (synonym.toLowerCase() !== dept.toLowerCase()) {
          results.push(before + synonym + after);
        }
      }
      // Only substitute the first matching department to avoid cross-department expansion
      break;
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3. Expansion logic
// ---------------------------------------------------------------------------

function expandSingleTitle(title: string): string[] {
  const expanded: string[] = [title];
  const lower = title.toLowerCase().trim();

  // --- Abbreviation ↔ Full form ---
  if (ABBREVIATION_MAP[lower]) {
    expanded.push(ABBREVIATION_MAP[lower]);
  }
  if (FULL_FORM_MAP[lower]) {
    expanded.push(FULL_FORM_MAP[lower]);
  }

  // --- Role variants ---

  // Founder → Co-Founder, Co-founder
  if (lower === "founder") {
    expanded.push("Co-Founder", "Co-founder");
  }

  // Owner → Co-Owner
  if (lower === "owner") {
    expanded.push("Co-Owner");
  }

  // "Director of X" → "X Director", "Head of X"
  const directorOfMatch = lower.match(/^director of\s+(.+)$/);
  if (directorOfMatch) {
    const dept = directorOfMatch[1];
    const capitalized = capitalizeWords(dept);
    expanded.push(`${capitalized} Director`);
    expanded.push(`Head of ${capitalized}`);
  }

  // "Head of X" → "X Director", "VP X", "VP of X"
  const headOfMatch = lower.match(/^head of\s+(.+)$/);
  if (headOfMatch) {
    const dept = headOfMatch[1];
    const capitalized = capitalizeWords(dept);
    expanded.push(`${capitalized} Director`);
    expanded.push(`VP ${capitalized}`);
    expanded.push(`VP of ${capitalized}`);
    expanded.push(`Vice President of ${capitalized}`);
  }

  // "VP X" (not "VP of X") → "Head of X", "VP of X", "Vice President of X"
  const vpMatch = lower.match(/^vp\s+(?!of\s)(.+)$/);
  if (vpMatch) {
    const dept = vpMatch[1];
    const capitalized = capitalizeWords(dept);
    expanded.push(`Head of ${capitalized}`);
    expanded.push(`VP of ${capitalized}`);
    expanded.push(`Vice President of ${capitalized}`);
  }

  // "VP of X" → "Head of X", "VP X", "Vice President of X"
  const vpOfMatch = lower.match(/^vp of\s+(.+)$/);
  if (vpOfMatch) {
    const dept = vpOfMatch[1];
    const capitalized = capitalizeWords(dept);
    expanded.push(`Head of ${capitalized}`);
    expanded.push(`VP ${capitalized}`);
    expanded.push(`Vice President of ${capitalized}`);
  }

  // "X Manager" → "X Lead", "Senior X Manager"
  const managerMatch = lower.match(/^(.+)\s+manager$/);
  if (managerMatch) {
    const prefix = managerMatch[1];
    const capitalized = capitalizeWords(prefix);
    expanded.push(`${capitalized} Lead`);
    expanded.push(`Senior ${capitalized} Manager`);
  }

  // "X Director" → "Head of X", "VP X"
  const directorSuffixMatch = lower.match(/^(.+)\s+director$/);
  if (directorSuffixMatch) {
    const dept = directorSuffixMatch[1];
    const capitalized = capitalizeWords(dept);
    expanded.push(`Head of ${capitalized}`);
    expanded.push(`VP ${capitalized}`);
    expanded.push(`VP of ${capitalized}`);
  }

  // "X Lead" → "X Manager"
  const leadMatch = lower.match(/^(.+)\s+lead$/);
  if (leadMatch) {
    const prefix = leadMatch[1];
    const capitalized = capitalizeWords(prefix);
    expanded.push(`${capitalized} Manager`);
  }

  // "Senior X" → "X Lead", "X Manager" (within same seniority band)
  const seniorMatch = lower.match(/^senior\s+(.+)$/);
  if (seniorMatch && !seniorMatch[1].includes("manager") && !seniorMatch[1].includes("director")) {
    const role = seniorMatch[1];
    const capitalized = capitalizeWords(role);
    expanded.push(`${capitalized} Lead`);
  }

  // --- Department synonyms ---
  // Apply to every title we have so far (including role-expanded ones),
  // but skip C-suite full forms (e.g. "Chief Technology Officer") since
  // those are canonical titles, not compositional department + role combos.
  const csuiteForms = new Set(
    Object.values(ABBREVIATION_MAP).map((v) => v.toLowerCase()),
  );
  const withDeptSynonyms: string[] = [];
  for (const t of expanded) {
    if (csuiteForms.has(t.toLowerCase())) continue;
    withDeptSynonyms.push(...applyDepartmentSynonyms(t));
  }
  expanded.push(...withDeptSynonyms);

  return expanded;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalizeWords(str: string): string {
  return str
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Case-insensitive deduplication. Preserves the first occurrence of each
 * unique (lowercased) title.
 */
function deduplicateTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const title of titles) {
    const key = title.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(title);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expand an array of job titles into common variations.
 *
 * - Bidirectional abbreviation ↔ full form (CEO ↔ Chief Executive Officer)
 * - Role variants (Founder → Co-Founder, Director of X → Head of X, etc.)
 * - Seniority equivalents (Head of X → VP X, X Director)
 * - Department synonyms (Marketing ↔ Growth, Sales ↔ Business Development)
 * - Common suffix variants (Manager → Lead, Director → Head)
 * - Case-insensitive matching, original casing preserved
 * - Deduplicated output, originals always included
 * - Logs what was expanded
 *
 * @param titles - Array of job titles to expand
 * @returns Flat, deduplicated array of expanded titles
 */
export function expandJobTitles(titles: string[]): string[] {
  if (!titles || titles.length === 0) return [];

  const allExpanded: string[] = [];

  for (const title of titles) {
    if (typeof title === "string" && title.trim()) {
      const expanded = expandSingleTitle(title.trim());
      allExpanded.push(...expanded);

      // Log what was expanded (only if new variants were generated)
      const newVariants = expanded.filter(
        (e) => e.toLowerCase() !== title.trim().toLowerCase(),
      );
      if (newVariants.length > 0) {
        console.log(
          `[title-expansion] "${title}" → +${newVariants.length} variants: ${newVariants.slice(0, 5).join(", ")}${newVariants.length > 5 ? "..." : ""}`,
        );
      }
    }
  }

  return deduplicateTitles(allExpanded);
}
