import { prisma } from "@/lib/db";
import { EmailBisonClient } from "./client";

export interface SyncSendersResult {
  workspaces: number;
  synced: number;
  created: number;
  skipped: number;
  errors: string[];
}

/**
 * Pulls sender emails from EmailBison API for all workspaces and upserts
 * Sender records with emailAddress + emailBisonSenderId.
 *
 * Matching priority:
 * 1. Match by emailAddress (exact) within workspace
 * 2. Match by name within workspace (handles senders created without email yet)
 * 3. Create new Sender record if no match found
 *
 * LinkedIn-only senders (not present in EmailBison) are unaffected.
 */
export async function syncSendersForAllWorkspaces(): Promise<SyncSendersResult> {
  const result: SyncSendersResult = {
    workspaces: 0,
    synced: 0,
    created: 0,
    skipped: 0,
    errors: [],
  };

  const workspaces = await prisma.workspace.findMany({
    where: { apiToken: { not: null } },
    select: { slug: true, apiToken: true },
  });

  result.workspaces = workspaces.length;
  console.log(`[sync-senders] Found ${workspaces.length} workspace(s) with API tokens`);

  for (const workspace of workspaces) {
    const { slug, apiToken } = workspace;

    if (!apiToken) {
      result.skipped++;
      continue;
    }

    try {
      console.log(`[sync-senders] Processing workspace: ${slug}`);

      const client = new EmailBisonClient(apiToken);
      const senderEmails = await client.getSenderEmails();

      console.log(`[sync-senders] ${slug}: fetched ${senderEmails.length} sender(s) from EmailBison`);

      // Load all senders for this workspace once to avoid N+1 queries
      const existingSenders = await prisma.sender.findMany({
        where: { workspaceSlug: slug },
        select: {
          id: true,
          name: true,
          emailAddress: true,
          emailBisonSenderId: true,
          emailSenderName: true,
        },
      });

      const byEmail = new Map<string, (typeof existingSenders)[0]>();
      const byName = new Map<string, (typeof existingSenders)[0]>();
      for (const s of existingSenders) {
        if (s.emailAddress) byEmail.set(s.emailAddress.toLowerCase(), s);
        byName.set(s.name.toLowerCase(), s);
      }

      for (const senderEmail of senderEmails) {
        const emailKey = senderEmail.email.toLowerCase();
        const nameKey = (senderEmail.name ?? senderEmail.email).toLowerCase();

        // Priority 1: match by email address
        const matchedByEmail = byEmail.get(emailKey);
        if (matchedByEmail) {
          const needsUpdate =
            matchedByEmail.emailBisonSenderId !== senderEmail.id ||
            (senderEmail.name && matchedByEmail.emailSenderName !== senderEmail.name);

          if (needsUpdate) {
            await prisma.sender.update({
              where: { id: matchedByEmail.id },
              data: {
                emailBisonSenderId: senderEmail.id,
                ...(senderEmail.name ? { emailSenderName: senderEmail.name } : {}),
              },
            });
            console.log(`[sync-senders] ${slug}: updated sender by email — ${senderEmail.email}`);
          } else {
            console.log(`[sync-senders] ${slug}: no changes needed for — ${senderEmail.email}`);
          }
          result.synced++;
          continue;
        }

        // Priority 2: match by name
        const matchedByName = byName.get(nameKey);
        if (matchedByName) {
          await prisma.sender.update({
            where: { id: matchedByName.id },
            data: {
              emailAddress: senderEmail.email,
              emailBisonSenderId: senderEmail.id,
              ...(senderEmail.name ? { emailSenderName: senderEmail.name } : {}),
            },
          });
          console.log(`[sync-senders] ${slug}: matched sender by name and set email — ${senderEmail.email}`);
          result.synced++;
          continue;
        }

        // Priority 3: create new Sender record
        await prisma.sender.create({
          data: {
            workspaceSlug: slug,
            name: senderEmail.name ?? senderEmail.email,
            emailAddress: senderEmail.email,
            emailBisonSenderId: senderEmail.id,
            ...(senderEmail.name ? { emailSenderName: senderEmail.name } : {}),
            status: "active",
          },
        });
        console.log(`[sync-senders] ${slug}: created new sender — ${senderEmail.email}`);
        result.created++;
      }
    } catch (error) {
      const msg = `${slug}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[sync-senders] Error processing workspace ${slug}:`, error);
      result.errors.push(msg);
    }
  }

  console.log(
    `[sync-senders] Done: ${result.workspaces} workspaces, ${result.synced} synced, ${result.created} created, ${result.skipped} skipped, ${result.errors.length} errors`,
  );

  return result;
}
