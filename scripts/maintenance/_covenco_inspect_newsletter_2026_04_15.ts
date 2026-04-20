/**
 * Inspect Covenco Newsletter campaign body HTML to learn what paragraph
 * spacing pattern actually renders correctly in the Instantly editor.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";

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
  if (!res.ok) throw new Error(`GET failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const campaigns = await listAll();
  console.log(`Total campaigns: ${campaigns.length}\n`);
  for (const c of campaigns) {
    console.log(`- ${c.name ?? "(no name)"}  id=${c.id}  status=${c.status}`);
  }

  // Find Newsletter
  const newsletter = campaigns.find(
    (c) => /newsletter/i.test(c.name ?? ""),
  );
  if (!newsletter) {
    console.log("\nNo Newsletter campaign found in listing.");
    return;
  }
  console.log(`\n=== NEWSLETTER: ${newsletter.name} (${newsletter.id}) ===`);
  const full = await getCampaign(newsletter.id);
  console.log("status:", full.status, "text_only:", full.text_only);
  const steps = full.sequences?.[0]?.steps ?? [];
  console.log(`steps: ${steps.length}`);
  steps.forEach((s: any, i: number) => {
    const variants = s.variants ?? [];
    console.log(`\n--- Step ${i + 1} (${variants.length} variants) ---`);
    variants.forEach((v: any, vi: number) => {
      console.log(`  Variant ${vi} subject: ${JSON.stringify(v.subject)}`);
      console.log(`  Variant ${vi} body (raw):`);
      console.log(v.body);
      console.log(`  Variant ${vi} body (JSON-escaped):`);
      console.log(JSON.stringify(v.body));
    });
  });
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
