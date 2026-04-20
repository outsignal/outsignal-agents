/**
 * Test Instantly body format for Covenco - Backup Services Step 1 Variant A only.
 *
 * Admin reports previously-pushed plain-text \n\n bodies render as one block in
 * the Instantly UI. Hypothesis: UI treats body as HTML and collapses \n\n.
 * Test: push Step 1 V A as HTML with <p> paragraph tags, GET it back, print
 * raw stored value for admin to eyeball in the UI.
 *
 * Preserves all other steps and variants exactly as currently stored.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const CAMPAIGN_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d"; // Covenco - Backup Services
const API = "https://api.instantly.ai/api/v2";

async function getCampaign(id: string): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) throw new Error(`GET failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function patchCampaign(id: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function main() {
  const before = await getCampaign(CAMPAIGN_ID);
  console.log("BEFORE: text_only =", before.text_only);
  console.log("BEFORE: step 1 v A body:");
  console.log(JSON.stringify(before.sequences[0].steps[0].variants[0].body));
  console.log();

  // Deep clone sequences
  const seqs = JSON.parse(JSON.stringify(before.sequences));

  // Only mutate step 1 variant A
  const htmlBody =
    "<p>Hi {{firstName}},</p>" +
    "<p>Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.</p>" +
    "<p>With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.</p>" +
    "<p>Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?</p>" +
    "<p>Kind regards,<br>David Jerram<br>Mobile: +44 1753 478313</p>";

  seqs[0].steps[0].variants[0].body = htmlBody;

  // Switch campaign to HTML mode
  const payload: Record<string, unknown> = {
    sequences: seqs,
    text_only: false,
  };

  const updated = await patchCampaign(CAMPAIGN_ID, payload);
  console.log("PATCH OK");
  console.log("AFTER: text_only =", updated.text_only);
  console.log("AFTER: step 1 v A body:");
  console.log(JSON.stringify(updated.sequences[0].steps[0].variants[0].body));
  console.log();
  console.log("--- RAW STORED VALUE (step 1 v A) ---");
  console.log(updated.sequences[0].steps[0].variants[0].body);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
