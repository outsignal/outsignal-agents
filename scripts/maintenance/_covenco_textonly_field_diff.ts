/**
 * Diff Newsletter (known-good, 'Send emails as text-only' UI checkbox ticked)
 * vs Backup Services (checkbox UNticked) to identify the API field that
 * corresponds to the UI checkbox.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const BACKUP_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";

async function listAll(): Promise<any[]> {
  const all: any[] = [];
  let starting_after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${API}/campaigns`);
    url.searchParams.set("limit", "100");
    if (starting_after) url.searchParams.set("starting_after", starting_after);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
    });
    if (!res.ok) throw new Error(`LIST failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const items = json.items ?? json.data ?? [];
    all.push(...items);
    starting_after = json.next_starting_after;
    if (!starting_after || items.length === 0) break;
  }
  return all;
}

async function getCampaign(id: string): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) throw new Error(`GET ${id} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

type FlatEntry = { path: string; value: unknown };
function flatten(obj: any, path = "", out: FlatEntry[] = []): FlatEntry[] {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object") {
    out.push({ path, value: obj });
    return out;
  }
  if (Array.isArray(obj)) {
    // For arrays we don't recurse into items (sequences etc.) — body/subject irrelevant here.
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    flatten(v, p, out);
  }
  return out;
}

async function main() {
  // 1) Find Newsletter campaign
  const all = await listAll();
  const newsletter = all.find((c) => /newsletter/i.test(c.name ?? ""));
  if (!newsletter) throw new Error("Newsletter campaign not found");
  console.log(`Newsletter: ${newsletter.name} (${newsletter.id})`);
  console.log(`Backup Services: ${BACKUP_ID}\n`);

  const [nl, bk] = await Promise.all([getCampaign(newsletter.id), getCampaign(BACKUP_ID)]);

  // 2) Dump all top-level keys
  console.log("=== NEWSLETTER TOP-LEVEL KEYS ===");
  console.log(Object.keys(nl).sort().join("\n"));
  console.log("\n=== BACKUP TOP-LEVEL KEYS ===");
  console.log(Object.keys(bk).sort().join("\n"));

  // 3) List all boolean-valued paths in each
  const nlFlat = flatten(nl);
  const bkFlat = flatten(bk);
  const nlBool = nlFlat.filter((e) => typeof e.value === "boolean");
  const bkBool = bkFlat.filter((e) => typeof e.value === "boolean");

  console.log("\n=== NEWSLETTER boolean fields ===");
  for (const e of nlBool) console.log(`  ${e.path} = ${e.value}`);
  console.log("\n=== BACKUP boolean fields ===");
  for (const e of bkBool) console.log(`  ${e.path} = ${e.value}`);

  // 4) Diff: boolean fields where value differs between the two campaigns
  const nlMap = new Map(nlBool.map((e) => [e.path, e.value]));
  const bkMap = new Map(bkBool.map((e) => [e.path, e.value]));
  const allPaths = new Set<string>([...nlMap.keys(), ...bkMap.keys()]);
  console.log("\n=== BOOLEAN DIFFS (Newsletter vs Backup) ===");
  for (const p of [...allPaths].sort()) {
    const nv = nlMap.get(p);
    const bv = bkMap.get(p);
    if (nv !== bv) {
      console.log(`  ${p}: newsletter=${nv} backup=${bv}`);
    }
  }

  // 5) Hunt for any field whose name or nested path hints at text/plain/html/only
  console.log("\n=== NEWSLETTER keys matching /text|plain|html|only|markup|format/i ===");
  for (const e of nlFlat) {
    if (/text|plain|html|only|markup|format/i.test(e.path)) {
      console.log(`  ${e.path} = ${JSON.stringify(e.value)}`);
    }
  }
  console.log("\n=== BACKUP keys matching /text|plain|html|only|markup|format/i ===");
  for (const e of bkFlat) {
    if (/text|plain|html|only|markup|format/i.test(e.path)) {
      console.log(`  ${e.path} = ${JSON.stringify(e.value)}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
