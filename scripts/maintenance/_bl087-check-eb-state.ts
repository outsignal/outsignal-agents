import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

async function main() {
  const prisma = new PrismaClient();
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "1210-solutions" },
    select: { apiToken: true },
  });
  if (!ws.apiToken) throw new Error("no token");
  const eb = new EmailBisonClient(ws.apiToken);

  // List campaigns
  const campaigns = await (eb as any).request<any>(`/campaigns?per_page=50`, { revalidate: 0 });
  console.log("CAMPAIGNS:");
  for (const c of campaigns?.data ?? []) {
    console.log(`  id=${c.id} status=${c.status} name='${c.name}' leads=${c.lead_count ?? '?'} steps=${c.email_steps_count ?? '?'}`);
  }

  // Get canary leads from DB
  const canaryLeads = await prisma.targetListPerson.findMany({
    where: {
      list: { campaigns: { some: { id: "cmneqixpv0001p8710bov1fga" } } },
    },
    include: { person: { select: { email: true } } },
  });
  const sampleEmails = canaryLeads.slice(0, 3).map((l) => l.person.email).filter(Boolean);
  console.log(`\nCANARY DB has ${canaryLeads.length} target leads. Sample emails:`, sampleEmails);

  // Check first lead in EB
  if (sampleEmails[0]) {
    try {
      const probe = await (eb as any).request<any>(`/leads?search=${encodeURIComponent(sampleEmails[0])}`, { revalidate: 0 });
      console.log(`EB lead lookup for ${sampleEmails[0]}: count=${probe?.data?.length ?? 0}`);
      if (probe?.data?.length) {
        console.log(`  first match: id=${probe.data[0].id} email=${probe.data[0].email} created_at=${probe.data[0].created_at}`);
      }
    } catch (e: any) {
      console.log(`EB lead lookup err:`, e.message?.slice(0, 200));
    }
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
