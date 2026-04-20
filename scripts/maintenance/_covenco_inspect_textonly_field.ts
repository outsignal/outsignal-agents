/**
 * Inspect Instantly v2 campaign object to find the field corresponding to the
 * 'Send emails as text only' UI toggle. Dumps the full JSON shape of one
 * Covenco campaign so we can identify the correct boolean field name.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const BACKUP_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";

async function main() {
  const res = await fetch(`${API}/campaigns/${BACKUP_ID}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) {
    console.error(`GET failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const campaign = await res.json();

  // Dump top-level keys and any field whose name hints at 'text only'
  console.log("=== TOP-LEVEL KEYS ===");
  console.log(Object.keys(campaign).sort().join("\n"));

  console.log("\n=== KEYS matching /text|plain|html|only/i ===");
  const hits: Record<string, unknown> = {};
  function scan(obj: any, path = "") {
    if (obj === null || obj === undefined) return;
    if (typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      const p = path ? `${path}.${k}` : k;
      if (/text|plain|html|only/i.test(k)) {
        hits[p] = v;
      }
      if (typeof v === "object" && v !== null && !Array.isArray(v)) scan(v, p);
    }
  }
  scan(campaign);
  console.log(JSON.stringify(hits, null, 2));

  console.log("\n=== campaign_schedule keys (if present) ===");
  if (campaign.campaign_schedule) console.log(Object.keys(campaign.campaign_schedule).join(", "));

  console.log("\n=== Full top-level flat view (non-object values only) ===");
  for (const [k, v] of Object.entries(campaign)) {
    if (typeof v !== "object" || v === null) {
      console.log(`${k}: ${JSON.stringify(v)}`);
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
