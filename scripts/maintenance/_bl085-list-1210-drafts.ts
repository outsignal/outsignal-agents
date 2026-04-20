/**
 * List 1210-solutions draft EB campaigns so we know what orphans exist.
 * Read-only.
 */
import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";

async function main() {
  const prisma = new PrismaClient();
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "1210-solutions" },
    select: { apiToken: true },
  });
  const client = new EmailBisonClient(ws.apiToken!);

  // List all campaigns in workspace
  console.log("=== 1210-solutions EB campaigns ===");
  try {
    // Try getCampaigns helper — it may paginate.
    const list = await client.getCampaigns({ perPage: 50 });
    const drafts = list.filter((c) => c.status === "draft");
    console.log(`Total: ${list.length}, drafts: ${drafts.length}`);
    drafts.forEach((c) => {
      console.log(`  id=${c.id} status=${c.status} name='${c.name}' created=${c.created_at ?? '?'}`);
    });
    console.log("\nAll (non-draft):");
    list.filter((c) => c.status !== "draft").forEach((c) => {
      console.log(`  id=${c.id} status=${c.status} name='${c.name}'`);
    });
  } catch (e) {
    console.log("getCampaigns error:", e instanceof Error ? e.message : String(e));
  }

  // Probe 80, 81, 82 individually
  for (const ebId of [80, 81, 82]) {
    console.log(`\n--- EB ${ebId} ---`);
    try {
      const c = await client.getCampaign(ebId);
      console.log(`  EXISTS: id=${c.id} status=${c.status} name='${c.name}'`);
    } catch (e) {
      console.log(`  NOT FOUND or ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
