import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { createInviteAndSendEmail } from "@/lib/member-invite";

async function main() {
  const slug = "yoopknows";
  const oldEmail = "himself@peppesilletti.io";
  const newEmail = "peppe@yoopknows.io";

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) throw new Error(`Workspace '${slug}' not found`);

  const existing = await prisma.member.findUnique({
    where: { email_workspaceSlug: { email: oldEmail, workspaceSlug: slug } },
  });
  if (!existing) throw new Error(`Member ${oldEmail} not found in ${slug}`);

  const conflict = await prisma.member.findUnique({
    where: { email_workspaceSlug: { email: newEmail, workspaceSlug: slug } },
  });
  if (conflict) throw new Error(`Target address ${newEmail} already exists as member ${conflict.id}`);

  const updated = await prisma.member.update({
    where: { id: existing.id },
    data: { email: newEmail },
    select: { id: true, email: true, role: true, status: true, workspaceSlug: true, invitedBy: true, invitedAt: true, updatedAt: true },
  });

  console.log("--- member row update ---");
  console.log(JSON.stringify({ before: { id: existing.id, email: existing.email }, after: updated }, null, 2));

  const before = new Date();
  await createInviteAndSendEmail(newEmail, ws.slug, ws.name);

  const audit = await prisma.notificationAuditLog.findFirst({
    where: {
      notificationType: "magic_link",
      recipient: newEmail,
      workspaceSlug: ws.slug,
      createdAt: { gte: before },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, recipient: true, status: true, createdAt: true, errorMessage: true },
  });

  const token = await prisma.magicLinkToken.findFirst({
    where: { email: newEmail, workspaceSlug: ws.slug, createdAt: { gte: before } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, createdAt: true, expiresAt: true },
  });

  console.log("\n--- notification audit ---");
  console.log(JSON.stringify(audit, null, 2));

  console.log("\n--- magic link token ---");
  if (token) {
    const ttlHours = (token.expiresAt.getTime() - token.createdAt.getTime()) / (60 * 60 * 1000);
    console.log(JSON.stringify({ ...token, ttlHours }, null, 2));
  } else {
    console.log("(no token found)");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
