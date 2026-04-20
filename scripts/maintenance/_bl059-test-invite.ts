/**
 * _bl059-test-invite.ts
 *
 * Fires the real createInviteAndSendEmail() path (src/lib/member-invite.ts)
 * against jonathan@outsignal.ai for the 'outsignal' workspace to verify the
 * BL-059 fix: invite emails now say "24 hours" instead of "30 minutes".
 *
 * Jonathan is already a member of every workspace, so the CLI (which creates
 * a Member row) would reject with "already exists". We call the email-send
 * helper directly — same function the CLI and /api/workspace/[slug]/members
 * route invoke, so the HTML body + TTL wording is identical to Peppe's
 * invite from last week.
 */
import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { prisma } from "@/lib/db";
import { createInviteAndSendEmail, MAGIC_LINK_TTL_HUMAN } from "@/lib/member-invite";

async function main() {
  const email = "jonathan@outsignal.ai";
  const slug = "outsignal";

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) throw new Error(`Workspace '${slug}' not found`);

  const before = new Date();
  console.log(`[${before.toISOString()}] Sending test invite...`);
  console.log(`  to: ${email}`);
  console.log(`  workspace: ${ws.name} (${ws.slug})`);
  console.log(`  expected expiry wording: "${MAGIC_LINK_TTL_HUMAN}"`);

  await createInviteAndSendEmail(email, ws.slug, ws.name);

  const audit = await prisma.notificationAuditLog.findFirst({
    where: {
      notificationType: "magic_link",
      recipient: email,
      workspaceSlug: ws.slug,
      createdAt: { gte: before },
    },
    orderBy: { createdAt: "desc" },
  });

  const token = await prisma.magicLinkToken.findFirst({
    where: { email, workspaceSlug: ws.slug, createdAt: { gte: before } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true },
  });

  console.log("\n--- audit log ---");
  console.log(JSON.stringify(audit, null, 2));
  console.log("\n--- magic link token ---");
  if (token) {
    const ttlMs = token.expiresAt.getTime() - token.createdAt.getTime();
    const ttlHours = ttlMs / (60 * 60 * 1000);
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
