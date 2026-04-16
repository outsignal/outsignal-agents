/**
 * Pre-flight Task 2 (READ-ONLY) — custom-variable scan for the 6 Lime
 * approved campaigns.
 *
 * For each campaign, grep the step subject + body strings for
 * single-curly UPPERCASE tokens `{TOKEN}` (the EB / Outsignal canonical
 * form — see src/lib/emailbison/variable-transform.ts).
 *
 * Classify each token:
 *   - BUILT-IN: vendor-confirmed EB lead / sender tokens
 *   - MAPPED:   covered by VAR_MAP_UPPER in variable-transform.ts
 *   - DEFENSIVE: known-good EB pass-through (sender_*)
 *   - CUSTOM:   outside the above — would either need pre-creation in the
 *               Lime EB workspace as a custom variable, or writer drift.
 *
 * No writes. No EB calls.
 */

import { prisma } from "@/lib/db";

// Mirror src/lib/emailbison/variable-transform.ts:71-77
const VAR_MAP_UPPER = new Set<string>([
  "FIRSTNAME",
  "LASTNAME",
  "COMPANYNAME",
  "JOBTITLE",
  "EMAIL",
]);

// Mirror src/lib/emailbison/variable-transform.ts:91-109
const KNOWN_EB_TOKENS = new Set<string>([
  // Vendor-confirmed lead built-ins
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "TITLE",
  "COMPANY",
  // Vendor-confirmed sender signature built-ins
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
  "SENDER_EMAIL_SIGNATURE",
  // Defensive sender pass-through
  "SENDER_LAST_NAME",
  "SENDER_EMAIL",
  "SENDER_TITLE",
  "SENDER_COMPANY",
]);

const BUILTIN_VENDOR = new Set<string>([
  "FIRST_NAME",
  "LAST_NAME",
  "EMAIL",
  "TITLE",
  "COMPANY",
  "SENDER_FIRST_NAME",
  "SENDER_FULL_NAME",
  "SENDER_EMAIL_SIGNATURE",
]);
const DEFENSIVE_SENDER = new Set<string>([
  "SENDER_LAST_NAME",
  "SENDER_EMAIL",
  "SENDER_TITLE",
  "SENDER_COMPANY",
]);

const CAMPAIGN_IDS: readonly string[] = [
  "cmnpwzv9e010np8itsf3f35oy",
  "cmnpwzwi5011sp8itj20w1foq",
  "cmnpwzxmg012gp8itxv4dvmyb",
  "cmnpwzym5014op8it2cpupfwx",
  "cmnpx037s01dcp8itzzilfdfb",
  "cmnq5nivc0001p8534g0k4wr6",
];

// Same regex as transformVariablesForEB — single-curly, UPPER_SNAKE, no
// negative-lookaround on double-curly is intentional here because we WANT
// to catch any drift (double-curly tokens would indicate writer drift that
// the transformer wouldn't rewrite anyway).
const TOKEN_RE = /\{([A-Z_][A-Z0-9_]*)\}/g;

function classify(
  token: string,
): "BUILT-IN" | "MAPPED" | "DEFENSIVE" | "CUSTOM" {
  if (BUILTIN_VENDOR.has(token)) return "BUILT-IN";
  if (VAR_MAP_UPPER.has(token)) return "MAPPED";
  if (DEFENSIVE_SENDER.has(token)) return "DEFENSIVE";
  return "CUSTOM";
}

function extractTokens(text: string | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    out.push(m[1]);
  }
  return out;
}

async function main() {
  // Track across the whole batch which custom tokens appear anywhere —
  // the PM needs this for the "pre-create or extend map?" decision.
  const globalCustom = new Map<
    string,
    Array<{ campaignId: string; step: number; field: string }>
  >();

  for (const id of CAMPAIGN_IDS) {
    const c = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, name: true, emailSequence: true },
    });
    console.log(`\n=== ${id} (${c?.name ?? "???"}) ===`);
    if (!c || c.emailSequence == null) {
      console.log(`  [SKIP] no campaign row or emailSequence null`);
      continue;
    }
    let parsed: unknown;
    try {
      parsed =
        typeof c.emailSequence === "string"
          ? JSON.parse(c.emailSequence)
          : c.emailSequence;
    } catch (e) {
      console.log(
        `  [SKIP] emailSequence JSON.parse threw: ${(e as Error).message}`,
      );
      continue;
    }
    if (!Array.isArray(parsed)) {
      console.log(
        `  [SKIP] emailSequence parsed but not an array (type=${typeof parsed})`,
      );
      continue;
    }
    const seq = parsed as Array<Record<string, unknown>>;

    const distinct = new Map<string, number>(); // token -> hits
    for (let i = 0; i < seq.length; i++) {
      const step = seq[i] ?? {};
      const fields = {
        subjectLine:
          typeof step.subjectLine === "string" ? step.subjectLine : "",
        subjectVariantB:
          typeof step.subjectVariantB === "string" ? step.subjectVariantB : "",
        body: typeof step.body === "string" ? step.body : "",
        bodyText: typeof step.bodyText === "string" ? step.bodyText : "",
      };
      for (const [fieldName, txt] of Object.entries(fields)) {
        const tokens = extractTokens(txt);
        for (const t of tokens) {
          distinct.set(t, (distinct.get(t) ?? 0) + 1);
          if (classify(t) === "CUSTOM") {
            const arr = globalCustom.get(t) ?? [];
            arr.push({ campaignId: id, step: i, field: fieldName });
            globalCustom.set(t, arr);
          }
        }
      }
    }

    if (distinct.size === 0) {
      console.log(`  (no {UPPER_TOKEN} variables found)`);
    } else {
      const rows = Array.from(distinct.entries()).sort();
      for (const [tok, n] of rows) {
        console.log(
          `  {${tok}}  x${n}  -> ${classify(tok)}`,
        );
      }
    }

    // Specific spot-checks mentioned in the brief
    const hasLastEmailMonth = distinct.has("LASTEMAILMONTH");
    const hasLocation = distinct.has("LOCATION");
    const senderVariants = Array.from(distinct.keys()).filter((k) =>
      k.startsWith("SENDER_"),
    );
    console.log(
      `  spot-check: LASTEMAILMONTH=${hasLastEmailMonth} LOCATION=${hasLocation} SENDER_*=[${senderVariants.join(",")}]`,
    );
  }

  console.log(`\n=== GLOBAL CUSTOM-TOKEN ROLL-UP ===`);
  if (globalCustom.size === 0) {
    console.log(`  (none — all tokens are BUILT-IN / MAPPED / DEFENSIVE)`);
  } else {
    for (const [tok, hits] of globalCustom) {
      console.log(
        `  {${tok}} — ${hits.length} occurrences across ${new Set(hits.map((h) => h.campaignId)).size} campaigns`,
      );
      for (const h of hits.slice(0, 4)) {
        console.log(
          `    at campaign=${h.campaignId} step=${h.step} field=${h.field}`,
        );
      }
      if (hits.length > 4) console.log(`    ... (${hits.length - 4} more)`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
