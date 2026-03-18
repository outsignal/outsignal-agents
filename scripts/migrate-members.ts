/**
 * Migration script: Populate Member records from workspace clientEmails/notificationEmails.
 *
 * For each workspace, reads clientEmails and notificationEmails JSON arrays,
 * then creates a Member record for each unique email found across both arrays.
 *
 * Status is determined by checking MagicLinkToken records:
 * - "active" if any used:true token exists for that email
 * - "invited" otherwise
 *
 * Safe to run multiple times (uses upsert).
 * Does NOT remove clientEmails/notificationEmails fields (rollback safety).
 *
 * Usage:
 *   npx tsx scripts/migrate-members.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((s: unknown) => String(s).toLowerCase().trim()).filter(Boolean);
    }
    return [];
  } catch {
    return [];
  }
}

async function main() {
  console.log("Starting Member migration from workspace email fields...\n");

  const workspaces = await prisma.workspace.findMany({
    select: {
      slug: true,
      name: true,
      clientEmails: true,
      notificationEmails: true,
    },
  });

  console.log(`Found ${workspaces.length} workspaces\n`);

  // Pre-fetch all magic link tokens grouped by email for status detection
  const allTokens = await prisma.magicLinkToken.findMany({
    select: {
      email: true,
      used: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Build lookup: email -> { hasUsedToken, lastLoginAt }
  const tokenLookup = new Map<string, { hasUsedToken: boolean; lastLoginAt: Date | null }>();
  for (const token of allTokens) {
    const email = token.email.toLowerCase().trim();
    const existing = tokenLookup.get(email);
    if (!existing) {
      tokenLookup.set(email, {
        hasUsedToken: token.used,
        lastLoginAt: token.used ? token.createdAt : null,
      });
    } else {
      if (token.used && !existing.hasUsedToken) {
        existing.hasUsedToken = true;
      }
      if (token.used && (!existing.lastLoginAt || token.createdAt > existing.lastLoginAt)) {
        existing.lastLoginAt = token.createdAt;
      }
    }
  }

  let totalCreated = 0;
  let totalUpdated = 0;

  for (const ws of workspaces) {
    const clientEmails = parseJsonArray(ws.clientEmails);
    const notificationEmails = parseJsonArray(ws.notificationEmails);

    // Collect all unique emails across both arrays
    const allEmails = new Set([...clientEmails, ...notificationEmails]);

    if (allEmails.size === 0) {
      console.log(`  [${ws.slug}] ${ws.name} — no emails, skipping`);
      continue;
    }

    let created = 0;
    let updated = 0;

    for (const email of allEmails) {
      const isInNotifications = notificationEmails.includes(email);
      const tokenInfo = tokenLookup.get(email);
      const status = tokenInfo?.hasUsedToken ? "active" : "invited";
      const lastLoginAt = tokenInfo?.lastLoginAt ?? null;

      const result = await prisma.member.upsert({
        where: {
          email_workspaceSlug: {
            email,
            workspaceSlug: ws.slug,
          },
        },
        create: {
          email,
          role: "viewer",
          workspaceSlug: ws.slug,
          notificationsEnabled: isInNotifications,
          status,
          lastLoginAt,
        },
        update: {
          notificationsEnabled: isInNotifications,
          status,
          lastLoginAt,
        },
      });

      // Check if this was a create or update by comparing createdAt and updatedAt
      const timeDiff = Math.abs(result.updatedAt.getTime() - result.createdAt.getTime());
      if (timeDiff < 1000) {
        created++;
      } else {
        updated++;
      }
    }

    totalCreated += created;
    totalUpdated += updated;
    console.log(`  [${ws.slug}] ${ws.name} — ${allEmails.size} emails (${created} created, ${updated} updated)`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total members created: ${totalCreated}`);
  console.log(`Total members updated: ${totalUpdated}`);
  console.log(`Total: ${totalCreated + totalUpdated}`);
  console.log(`\nDone. clientEmails/notificationEmails fields left intact for rollback safety.`);
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
