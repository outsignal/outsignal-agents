/**
 * Test v2: apply Newsletter-pattern inline margin styles to paragraphs on
 * Covenco - Backup Services Step 1 Variant A only.
 *
 * Newsletter inspection (821a5d82-a6bb-43c2-ba22-45aa96d4b778) showed body
 * HTML uses <p style="margin:0 0 18px 0">...</p> for vertical spacing, with
 * the last paragraph in a block using margin:0.
 *
 * Hypothesis: bare <p> tags collapse in Instantly's Froala editor because
 * default p margins are zeroed. Inline margin is required to get a visible
 * gap between paragraphs in both the editor and sent email rendering.
 *
 * Scope: ONE variant body only. All other steps/variants untouched.
 * Subjects untouched. Campaign status (DRAFT/0) preserved.
 * text_only already false from iteration 1; re-asserted here.
 *
 * Preserves David's copy exactly as admin specified (no "Mobile:" prefix).
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const CAMPAIGN_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";
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

  if (before.status !== 0) {
    throw new Error(`REFUSING: status is ${before.status}, expected 0 (DRAFT)`);
  }
  console.log("status before:", before.status, "text_only before:", before.text_only);
  console.log("BEFORE step 1 v A body:");
  console.log(before.sequences[0].steps[0].variants[0].body);
  console.log();

  const seqs = JSON.parse(JSON.stringify(before.sequences));

  // Newsletter pattern: margin:0 0 18px 0 between paragraphs, margin:0 on last
  const GAP = 'style="margin:0 0 18px 0"';
  const LAST = 'style="margin:0"';
  const htmlBody =
    `<p ${GAP}>Hi {{firstName}},</p>` +
    `<p ${GAP}>Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.</p>` +
    `<p ${GAP}>With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.</p>` +
    `<p ${GAP}>Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?</p>` +
    `<p ${LAST}>Kind regards,<br />David Jerram<br />+44 1753 478313</p>`;

  seqs[0].steps[0].variants[0].body = htmlBody;

  const updated = await patchCampaign(CAMPAIGN_ID, {
    sequences: seqs,
    text_only: false,
  });

  console.log("PATCH OK");
  console.log("status after:", updated.status, "text_only after:", updated.text_only);
  console.log();
  console.log("--- RAW STORED VALUE (Backup Services Step 1 Variant A) ---");
  console.log(updated.sequences[0].steps[0].variants[0].body);
  console.log();
  console.log("--- Other variants untouched (verify subjects + first 80 chars of body) ---");
  for (let i = 0; i < 3; i++) {
    const v0 = updated.sequences[0].steps[i].variants[0];
    const v1 = updated.sequences[0].steps[i].variants[1];
    console.log(
      `Step ${i + 1} V A subject=${JSON.stringify(v0.subject)} body[0..80]=${JSON.stringify(String(v0.body).slice(0, 80))}`,
    );
    console.log(
      `Step ${i + 1} V B subject=${JSON.stringify(v1.subject)} body[0..80]=${JSON.stringify(String(v1.body).slice(0, 80))}`,
    );
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
