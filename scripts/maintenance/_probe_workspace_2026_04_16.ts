import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const BASE = "https://app.emailguard.io/api/v1";
const TOKEN = process.env.EMAILGUARD_API_TOKEN;

async function main() {
  const res = await fetch(`${BASE}/workspaces/current`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
