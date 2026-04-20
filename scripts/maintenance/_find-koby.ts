import { prisma } from "@/lib/db";

async function main() {
  const replies = await prisma.reply.findMany({
    where: {
      OR: [
        { bodyText: { contains: "Koby", mode: "insensitive" } },
        { senderName: { contains: "Koby", mode: "insensitive" } },
        { senderEmail: { contains: "koby", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, senderEmail: true, senderName: true, receivedAt: true,
      workspaceSlug: true, campaignId: true, campaignName: true, subject: true,
      bodyText: true, intent: true, outboundSubject: true, outboundBody: true,
    },
    take: 10,
    orderBy: { receivedAt: "desc" },
  });
  console.log("Replies from/mentioning Koby (" + replies.length + " results):");
  for (const r of replies) {
    console.log("\n--- Reply", r.id, "---");
    console.log("From:", r.senderName, "<" + r.senderEmail + ">");
    console.log("Received:", r.receivedAt);
    console.log("Workspace:", r.workspaceSlug, "| Campaign:", r.campaignName);
    console.log("Subject:", r.subject);
    console.log("Intent:", r.intent);
    console.log("Body:");
    console.log(r.bodyText?.substring(0, 800));
    if (r.outboundBody) {
      console.log("\nPrior outbound (our message to them):");
      console.log("Subject:", r.outboundSubject);
      console.log(r.outboundBody?.substring(0, 800));
    }
  }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
