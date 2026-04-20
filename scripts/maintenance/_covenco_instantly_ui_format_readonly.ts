/**
 * READ-ONLY diagnostic: inspect format Instantly stored after admin UI edit.
 * Backup Services campaign only. No writes, no PATCH.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const CAMPAIGN_ID = "578c27a2-717c-4ef2-b6d8-031b07261f4d";

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

function countOccurrences(s: string, pattern: RegExp): number {
  return (s.match(pattern) || []).length;
}

async function main() {
  const res = await fetch(`${API}/campaigns/${CAMPAIGN_ID}`, {
    headers: { Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}` },
  });
  if (!res.ok) throw new Error(`GET failed: ${res.status} ${await res.text()}`);
  const c = await res.json();

  console.log(`=== CAMPAIGN ===`);
  console.log(`name: ${c.name}`);
  console.log(`status: ${c.status}`);
  console.log(`text_only: ${c.text_only}`);

  const steps = c.sequences?.[0]?.steps;
  if (!Array.isArray(steps)) throw new Error("No steps");

  for (let si = 0; si < steps.length; si++) {
    const variants = steps[si].variants || [];
    for (let vi = 0; vi < variants.length; vi++) {
      const v = variants[vi];
      const body: string = v.body ?? "";
      const subj: string = v.subject ?? "";
      const letter = String.fromCharCode(65 + vi);
      console.log(`\n=== Step ${si + 1} Variant ${letter} ===`);
      console.log(`subject (raw): ${JSON.stringify(subj)}`);
      console.log(`body length: ${body.length}`);
      console.log(`\\r count: ${countOccurrences(body, /\r/g)}`);
      console.log(`\\n count: ${countOccurrences(body, /\n/g)}`);
      console.log(`\\r\\n pairs: ${countOccurrences(body, /\r\n/g)}`);
      console.log(`<p count: ${countOccurrences(body, /<p[\s>]/gi)}`);
      console.log(`<br count: ${countOccurrences(body, /<br/gi)}`);
      console.log(`<div count: ${countOccurrences(body, /<div[\s>]/gi)}`);
      console.log(`<span count: ${countOccurrences(body, /<span[\s>]/gi)}`);
      console.log(`&nbsp; count: ${countOccurrences(body, /&nbsp;/gi)}`);
      console.log(`other entities (&...;) count: ${countOccurrences(body, /&[a-z]+;/gi)}`);
      console.log(`body (hex-escaped):`);
      console.log(hexEscape(body));
    }
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
