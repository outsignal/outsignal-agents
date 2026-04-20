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
  console.log(`[${method}] ${path} -> ${res.status}: ${text.slice(0, 400)}`);
}

async function main() {
  const uuid = "a1729da6-e6eb-45c1-89b0-30f6600fa1f6";
  const domain = "laddergroup.co";

  // Try various verbs/paths — workspace HAS spamhaus credits so feature is on
  await hit("PUT", `/spamhaus-intelligence/domain-reputation`, { domain });
  await hit("PUT", `/spamhaus-intelligence/domain-reputation/${uuid}`, { domain });
  await hit("PATCH", `/domains/spamhaus-domain-reputation/${uuid}`);
  await hit("PATCH", `/domains/domain-reputation/${uuid}`);
  await hit("POST", `/spamhaus-intelligence/domain-reputation-checks`, { domain });
  await hit("POST", `/domains/${uuid}/spamhaus-intelligence/domain-reputation`);
  await hit("GET", `/domains/${uuid}/domain-reputation`);
  await hit("GET", `/spamhaus-intelligence/domain-reputation?domain_uuid=${uuid}`);
  await hit("GET", `/spamhaus-intelligence/domain-reputation?per_page=50&page=1`);
  // Try with domain in path
  await hit("GET", `/spamhaus-intelligence/domain-reputation/domain/${encodeURIComponent(domain)}`);
  // Try listing with "run" or check"
  await hit("POST", `/spamhaus-intelligence/domain-reputation/check`, { domain });
  await hit("POST", `/spamhaus-intelligence/check`, { domain, type: "domain-reputation" });
  // Look at OPTIONS
  await hit("OPTIONS", `/spamhaus-intelligence/domain-reputation`);
  // Could be different naming — try snake_case paths
  await hit("POST", `/spamhaus-domain-reputation-checks`, { domain });
  await hit("POST", `/spamhaus-intelligence-checks`, { domain, type: "domain_reputation" });
  // Try workspace endpoints
  await hit("GET", `/workspaces/current/spamhaus-intelligence`);
  // docs-like
  await hit("GET", `/spamhaus-intelligence`);
}
main().catch(e => { console.error(e); process.exit(1); });
