import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

const BASE = "https://app.emailguard.io/api/v1";
const TOKEN = process.env.EMAILGUARD_API_TOKEN;

async function hit(method: string, path: string, body?: any) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`[${method}] ${path} -> ${res.status}: ${text.slice(0, 600)}`);
  return { status: res.status, text };
}

async function main() {
  const uuid = "a1729da6-e6eb-45c1-89b0-30f6600fa1f6"; // laddergroup.co
  const domain = "laddergroup.co";

  // Candidate Spamhaus endpoints (probe shape)
  await hit("GET", `/domains/${uuid}`);
  await hit("GET", `/domains/${uuid}/spamhaus-reputation`);
  await hit("GET", `/spamhaus-intelligence/domain-reputation/${uuid}`);
  await hit("GET", `/spamhaus-intelligence/domain-reputation?domain=${domain}`);
  await hit("GET", `/spamhaus-intelligence/domain-reputation`);
  await hit("POST", `/spamhaus-intelligence/domain-reputation`, { domain });
  await hit("POST", `/spamhaus-intelligence/domain-reputation`, { domain_uuid: uuid });
  await hit("PATCH", `/spamhaus-intelligence/domain-reputation/${uuid}`);
  await hit("PATCH", `/spamhaus-intelligence/domain-reputation`, { domain });
  await hit("GET", `/domains/${uuid}/spamhaus-intelligence`);
  await hit("GET", `/domains/${uuid}/a-record-reputation`);
  await hit("GET", `/domains/${uuid}/domain-context`);
  await hit("GET", `/domains/${uuid}/domain-senders`);
  await hit("GET", `/domains/${uuid}/nameserver-reputation`);
  await hit("GET", `/workspaces/current`);
}

main().catch(e => { console.error(e); process.exit(1); });
