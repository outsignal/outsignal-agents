/**
 * Deep inspect: dump FULL JSON of Newsletter and Backup Services campaigns,
 * including all nested arrays (sequences, steps, variants), to find any
 * field (top-level OR nested, boolean OR string/enum) that could correspond
 * to the 'Send emails as text-only (no HTML)' UI checkbox.
 */
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const BACKUP_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";
const NEWSLETTER_ID = "821a5d82-a6bb-43c2-ba22-45aa96d4b778";

async function getCampaign(id: string): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) throw new Error(`GET ${id} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const [nl, bk] = await Promise.all([getCampaign(NEWSLETTER_ID), getCampaign(BACKUP_ID)]);

  writeFileSync("/tmp/covenco_newsletter_full.json", JSON.stringify(nl, null, 2));
  writeFileSync("/tmp/covenco_backup_full.json", JSON.stringify(bk, null, 2));

  console.log("Dumped /tmp/covenco_newsletter_full.json and /tmp/covenco_backup_full.json");

  // Walk sequences/steps/variants and list ALL keys seen there.
  function scanArray(arr: any[], label: string) {
    console.log(`\n=== ${label} variant-level keys ===`);
    const allKeys = new Set<string>();
    for (const seq of arr ?? []) {
      for (const step of seq?.steps ?? []) {
        for (const variant of step?.variants ?? []) {
          for (const k of Object.keys(variant ?? {})) allKeys.add(k);
        }
      }
    }
    console.log([...allKeys].sort().join("\n"));

    // Also dump first variant fully for the structure
    const firstVariant = arr?.[0]?.steps?.[0]?.variants?.[0];
    if (firstVariant) {
      console.log(`\n${label} first variant keys + non-body/subject values:`);
      for (const [k, v] of Object.entries(firstVariant)) {
        if (k === "body" || k === "subject") continue;
        console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
      }
    }

    console.log(`\n${label} step-level keys:`);
    const stepKeys = new Set<string>();
    for (const seq of arr ?? []) {
      for (const step of seq?.steps ?? []) {
        for (const k of Object.keys(step ?? {})) stepKeys.add(k);
      }
    }
    console.log([...stepKeys].sort().join("\n"));

    console.log(`\n${label} seq-level keys:`);
    const seqKeys = new Set<string>();
    for (const seq of arr ?? []) for (const k of Object.keys(seq ?? {})) seqKeys.add(k);
    console.log([...seqKeys].sort().join("\n"));

    // Print first step non-variants content
    const firstStep = arr?.[0]?.steps?.[0];
    if (firstStep) {
      console.log(`\n${label} first step non-variants fields:`);
      for (const [k, v] of Object.entries(firstStep)) {
        if (k === "variants") continue;
        console.log(`  ${k}: ${JSON.stringify(v).slice(0, 200)}`);
      }
    }
  }

  scanArray(nl.sequences, "NEWSLETTER");
  scanArray(bk.sequences, "BACKUP");

  // Body format comparison: does Newsletter body contain HTML tags?
  const nlBody = nl.sequences?.[0]?.steps?.[0]?.variants?.[0]?.body;
  const bkBody = bk.sequences?.[0]?.steps?.[0]?.variants?.[0]?.body;
  console.log("\n=== BODY HTML-ness ===");
  console.log(
    `Newsletter body contains <html/p/br/div>? ${/<(html|p|br|div|span|body|table)[\s>]/i.test(nlBody ?? "")}`,
  );
  console.log(
    `Backup body contains <html/p/br/div>? ${/<(html|p|br|div|span|body|table)[\s>]/i.test(bkBody ?? "")}`,
  );
  console.log("Newsletter body first 500 chars:");
  console.log((nlBody ?? "").slice(0, 500));
  console.log("\nBackup body first 500 chars:");
  console.log((bkBody ?? "").slice(0, 500));
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
