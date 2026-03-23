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
 * 0. Match by emailBisonSenderId (most reliable — survives email/name changes)
 * 1. Match by emailAddress (exact) within workspace
 * 2. Match by name within workspace (only if name is unique — skips duplicates)
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

      console.log(`[sync-senders] ${slug}: fetched ${senderEmails.length} inbox(es) from EmailBison`);

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

      const byEbId = new Map<number, (typeof existingSenders)[0]>();
      const byEmail = new Map<string, (typeof existingSenders)[0]>();
      for (const s of existingSenders) {
        if (s.emailBisonSenderId) byEbId.set(s.emailBisonSenderId, s);
        if (s.emailAddress) byEmail.set(s.emailAddress.toLowerCase(), s);
      }

      // Only add to byName if the name is unique in this workspace
      const nameCounts = new Map<string, number>();
      for (const s of existingSenders) {
        const key = s.name.toLowerCase();
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      const byName = new Map<string, (typeof existingSenders)[0]>();
      for (const s of existingSenders) {
        const key = s.name.toLowerCase();
        if (nameCounts.get(key) === 1) {
          byName.set(key, s);
        }
      }

      for (const senderEmail of senderEmails) {
        const emailKey = senderEmail.email.toLowerCase();
        const nameKey = (senderEmail.name ?? senderEmail.email).toLowerCase();

        // Priority 0: match by emailBisonSenderId (most reliable)
        const matchedByEbId = byEbId.get(senderEmail.id);
        if (matchedByEbId) {
          const needsUpdate =
            matchedByEbId.emailAddress?.toLowerCase() !== emailKey ||
            (senderEmail.name && matchedByEbId.emailSenderName !== senderEmail.name);

          if (needsUpdate) {
            await prisma.sender.update({
              where: { id: matchedByEbId.id },
              data: {
                emailAddress: senderEmail.email,
                ...(senderEmail.name ? { emailSenderName: senderEmail.name } : {}),
              },
            });
            console.log(`[sync-senders] ${slug}: updated inbox by EB ID ${senderEmail.id} — ${senderEmail.email}`);
          } else {
            console.log(`[sync-senders] ${slug}: no changes needed for inbox — ${senderEmail.email}`);
          }
          result.synced++;
          continue;
        }

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
            console.log(`[sync-senders] ${slug}: updated inbox by email — ${senderEmail.email}`);
          } else {
            console.log(`[sync-senders] ${slug}: no changes needed for inbox — ${senderEmail.email}`);
          }
          result.synced++;
          continue;
        }

        // Priority 2: match by name (only if unique in workspace)
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
          console.log(`[sync-senders] ${slug}: matched inbox by name and set email — ${senderEmail.email}`);
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
        console.log(`[sync-senders] ${slug}: created new inbox — ${senderEmail.email}`);
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
