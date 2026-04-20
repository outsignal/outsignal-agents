/**
 * BL-085 probe — capture the FULL UNEXPECTED_RESPONSE error message (which
 * includes the raw response body) so we can see what shape EB is returning
 * that's tripping the Zod parse.
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

  console.log("=== Calling client.getSequenceSteps(82) ===");
  try {
    const r = await client.getSequenceSteps(82);
    console.log("Success:", JSON.stringify(r, null, 2));
  } catch (e: any) {
    console.log("Error class:", e.constructor.name);
    console.log("Error message:", e.message);
    console.log("Error stack top:", (e.stack ?? "").split("\n").slice(0, 5).join("\n"));
  }

  // Direct fetch bypass — read raw response body.
  console.log("\n=== Raw fetch /api/campaigns/v1.1/82/sequence-steps ===");
  const base = "https://app.outsignal.ai/api";
  const url = `${base}/campaigns/v1.1/82/sequence-steps`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${ws.apiToken!}`,
      "Content-Type": "application/json",
    },
  });
  console.log(`Status: ${resp.status} ${resp.statusText}`);
  const body = await resp.text();
  console.log(`Body (first 3000 chars):\n${body.slice(0, 3000)}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
