import { prisma } from "@/lib/db";

async function main() {
  const ws = await prisma.workspace.findUnique({ where: { slug: "lime-recruitment" }, select: { apiToken: true } });
  if (!ws?.apiToken) process.exit(1);
  
  const baseUrl = "https://app.outsignal.ai/api";
  
  // Get schedule
  console.log("=== Schedule for Lime E1 ===");
  const sched = await fetch(`${baseUrl}/campaigns/104/schedule`, {
    headers: { Authorization: `Bearer ${ws.apiToken}`, Accept: "application/json" },
  });
  console.log(JSON.stringify(await sched.json(), null, 2));
  
  // Get leads & their scheduled emails
  console.log("\n=== Lime E1 leads (first 3) with scheduled emails ===");
  const leads = await fetch(`${baseUrl}/campaigns/104/leads?per_page=3`, {
    headers: { Authorization: `Bearer ${ws.apiToken}`, Accept: "application/json" },
  });
  const leadsJson: any = await leads.json();
  console.log(JSON.stringify(leadsJson, null, 2).substring(0, 4000));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
