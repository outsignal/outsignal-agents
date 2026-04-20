/**
 * Covenco Instantly — CRLF line-ending test (SINGLE STEP ONLY).
 *
 * Hypothesis: Instantly plain-text send is collapsing \n\n paragraph breaks
 * into a single block when rendered in Gmail-style inboxes. RFC 5322 expects
 * CRLF. Try \r\n\r\n between paragraphs, \r\n within signoff block.
 *
 * Scope: Backup Services campaign → sequence 0 → step 0 (Step 1) → variant 0
 *        (Variant A) body only.
 *
 * Does NOT touch:
 *   - Any other campaign (8 untouched)
 *   - Step 2 or Step 3 on Backup Services
 *   - Variant B on Step 1 (kept as-is for comparison/A-B isolation)
 *   - Subjects
 *   - text_only flag (stays true)
 *   - Campaign status (stays DRAFT = 0)
 *   - Leads
 *
 * After PATCH: GET the campaign back, echo Variant A body as a hex-escaped
 * string so admin can eyeball whether Instantly persisted \r\n or normalized
 * to \n on ingest.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const CAMPAIGN_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d"; // Backup Services

// Body with CRLF between paragraphs and CRLF within the signoff block.
// David's wording preserved verbatim. Spintax {{off-site|immutable|offline}}
// and merge tags {{firstName}} / {{companyName}} preserved.
const CRLF_BODY =
  "Hi {{firstName}},\r\n\r\n" +
  "Many teams assume backup is covered until restore times slip, storage costs climb, or retention gaps create risk. Covenco delivers {{off-site|immutable|offline}} backup services built for secure recovery, not box-ticking.\r\n\r\n" +
  "With 35 years behind us, 4PB under management, and 3,000 customer servers protected, we help reduce pressure without adding complexity.\r\n\r\n" +
  "Worth exploring whether backup resilience at {{companyName}} feels as strong as it should?\r\n\r\n" +
  "Kind regards,\r\n" +
  "David Jerram\r\n" +
  "+44 1753 478313";

async function getCampaign(id: string): Promise<any> {
  const res = await fetch(`${API}/campaigns/${id}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) throw new Error(`GET ${id} failed: ${res.status} ${await res.text()}`);
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
  if (!res.ok) throw new Error(`PATCH ${id} failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

function hexEscape(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === "\r") out += "\\r";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  return out;
}

async function main() {
  console.log(`--- PRE-CHECK ---`);
  const before = await getCampaign(CAMPAIGN_ID);
  console.log(`name: ${before.name}`);
  console.log(`status: ${before.status} (expect 0 = DRAFT)`);
  console.log(`text_only: ${before.text_only} (expect true)`);

  if (before.status !== 0) {
    throw new Error(`REFUSING: campaign status is ${before.status}, expected 0 (DRAFT)`);
  }
  if (before.text_only !== true) {
    throw new Error(`REFUSING: campaign text_only is ${before.text_only}, expected true`);
  }

  const seqs = JSON.parse(JSON.stringify(before.sequences));
  if (!Array.isArray(seqs) || !seqs[0]?.steps || seqs[0].steps.length !== 3) {
    throw new Error("Unexpected sequence shape (expected 1 sequence, 3 steps)");
  }
  const step1Variants = seqs[0].steps[0].variants;
  if (!Array.isArray(step1Variants) || step1Variants.length !== 2) {
    throw new Error(`Step 1 expected 2 variants, got ${step1Variants?.length}`);
  }

  const variantASubjectBefore = step1Variants[0].subject;
  const variantBBodyBefore = step1Variants[1].body;
  const step2BodyBefore = seqs[0].steps[1].variants[0].body;
  const step3BodyBefore = seqs[0].steps[2].variants[0].body;

  console.log(`\nStep 1 Variant A current body (hex-escaped):`);
  console.log(hexEscape(step1Variants[0].body));

  // Mutate ONLY Step 1 Variant A body.
  step1Variants[0].body = CRLF_BODY;

  console.log(`\n--- PATCHING (sequences only, text_only untouched) ---`);
  await patchCampaign(CAMPAIGN_ID, { sequences: seqs });
  console.log(`PATCH ok`);

  console.log(`\n--- VERIFICATION (re-GET) ---`);
  const after = await getCampaign(CAMPAIGN_ID);
  console.log(`status: ${after.status} (expect 0)`);
  console.log(`text_only: ${after.text_only} (expect true)`);

  const afterStep1A = after.sequences[0].steps[0].variants[0];
  const afterStep1B = after.sequences[0].steps[0].variants[1];
  const afterStep2A = after.sequences[0].steps[1].variants[0];
  const afterStep3A = after.sequences[0].steps[2].variants[0];

  console.log(`\nStep 1 Variant A subject unchanged: ${afterStep1A.subject === variantASubjectBefore}`);
  console.log(`Step 1 Variant B body unchanged: ${afterStep1B.body === variantBBodyBefore}`);
  console.log(`Step 2 Variant A body unchanged: ${afterStep2A.body === step2BodyBefore}`);
  console.log(`Step 3 Variant A body unchanged: ${afterStep3A.body === step3BodyBefore}`);

  const storedBody: string = afterStep1A.body;
  const sentLen = CRLF_BODY.length;
  const storedLen = storedBody.length;
  const crCount = (storedBody.match(/\r/g) || []).length;
  const lfCount = (storedBody.match(/\n/g) || []).length;
  const crlfCount = (storedBody.match(/\r\n/g) || []).length;

  console.log(`\n--- STORED BODY ANALYSIS ---`);
  console.log(`sent length: ${sentLen}`);
  console.log(`stored length: ${storedLen}`);
  console.log(`\\r count: ${crCount}`);
  console.log(`\\n count: ${lfCount}`);
  console.log(`\\r\\n pair count: ${crlfCount}`);
  console.log(`exact match: ${storedBody === CRLF_BODY}`);

  if (crCount === 0 && lfCount > 0) {
    console.log(`VERDICT: Instantly stripped \\r — stored body is \\n-only (normalized to LF)`);
  } else if (crCount === lfCount && crlfCount === crCount) {
    console.log(`VERDICT: Instantly preserved CRLF pairs — stored as sent`);
  } else {
    console.log(`VERDICT: mixed/unexpected line-ending state`);
  }

  console.log(`\nStep 1 Variant A stored body (hex-escaped):`);
  console.log(hexEscape(storedBody));

  console.log(`\nStatus: awaiting admin Gmail test-send verification before propagating.`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
