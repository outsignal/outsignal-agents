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

  // List campaigns to confirm
  const campaignsBefore = await (eb as any).request<any>(`/campaigns?per_page=50`, { revalidate: 0 });
  console.log("BEFORE:");
  for (const c of campaignsBefore?.data ?? []) {
    console.log(`  id=${c.id} status=${c.status} name='${c.name}'`);
  }

  // Delete EB 84
  console.log("\nDELETE EB 84...");
  try {
    await (eb as any).request<any>(`/campaigns/84`, { method: "DELETE", revalidate: 0 });
    console.log("  delete returned OK");
  } catch (e: any) {
    console.log(`  delete error:`, e.message?.slice(0, 200));
  }

  await new Promise((r) => setTimeout(r, 2000));

  // Verify
  const campaignsAfter = await (eb as any).request<any>(`/campaigns?per_page=50`, { revalidate: 0 });
  console.log("\nAFTER:");
  for (const c of campaignsAfter?.data ?? []) {
    console.log(`  id=${c.id} status=${c.status} name='${c.name}'`);
  }
  console.log(`  total campaigns: ${campaignsAfter?.data?.length ?? 0}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
