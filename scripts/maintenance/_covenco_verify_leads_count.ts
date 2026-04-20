/**
 * Quick lead-queue count across the 9 Covenco Instantly campaigns.
 * Uses /api/v2/leads/list with campaign filter.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const API = "https://api.instantly.ai/api/v2";
const IDS = [
  "578c27a2-717c-4ef2-b6d8-031b07261f4d",
  "aacbce5d-f5a7-4156-8496-967c4efa5bfd",
  "d5c16e36-f3cf-4aef-af79-af23e302ca6e",
  "2bbb4ff1-eaed-4946-a62e-38d9cc24453e",
  "d6dce1e9-bebc-4537-aec7-17cbae52af10",
  "ebb2e715-8505-4944-88aa-fa2f326ce166",
  "b87c8795-4331-41c5-8d24-f888be7214d4",
  "f439a04c-e213-4dbd-bf0e-2f2463bf6b75",
  "9ef7b7eb-7e6d-4bfe-9962-e3f132d4e8b8",
];

async function countLeads(id: string): Promise<number> {
  let total = 0;
  let starting_after: string | undefined;
  for (let i = 0; i < 20; i++) {
    const body: Record<string, unknown> = { campaign: id, limit: 100 };
    if (starting_after) body.starting_after = starting_after;
    const res = await fetch(`${API}/leads/list`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.INSTANTLY_API_KEY_COVENCO}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`leads/list ${id}: ${res.status} ${await res.text()}`);
    const json = await res.json();
    const items = json.items || [];
    total += items.length;
    if (!json.next_starting_after) break;
    starting_after = json.next_starting_after;
  }
  return total;
}

async function main() {
  let grand = 0;
  for (const id of IDS) {
    const n = await countLeads(id);
    grand += n;
    console.log(`${id}: ${n}`);
  }
  console.log(`TOTAL: ${grand}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
