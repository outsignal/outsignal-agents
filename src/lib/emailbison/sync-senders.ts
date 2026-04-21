import { prisma } from "@/lib/db";
import { EmailBisonClient } from "./client";

export interface SyncSendersResult {
  workspaces: number;
  synced: number;
  created: number;
  deactivated: number;
  skipped: number;
  errors: string[];
}

/**
 * Pulls sender emails from EmailBison API for all workspaces and upserts
 * Sender records with emailAddress + emailBisonSenderId.
 *
 * Matching priority:
 * 1. Match by emailBisonSenderId (most reliable — survives email/name changes)
 * 2. Match by emailAddress (exact) within workspace
 * 3. Create new Sender record if no match found
 *
 * Name matching is intentionally excluded — one person (e.g. "Lucy Marshall")
 * can have many inboxes across different domains. Each inbox = 1 Sender record.
 *
 * After syncing, any Sender with an emailBisonSenderId that no longer exists
 * in the EB API response is deactivated (status='deactivated').
 *
 * LinkedIn-only senders (no emailBisonSenderId) are unaffected.
 */
export async function syncSendersForAllWorkspaces(): Promise<SyncSendersResult> {
  const result: SyncSendersResult = {
    workspaces: 0,
    synced: 0,
    created: 0,
    deactivated: 0,
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

      // INTENTIONAL-BROAD: sync must see ALL rows to match/create/deactivate.
      // Narrowing here would break inbox upsert and stale sender detection.
      const existingSenders = await prisma.sender.findMany({
        where: { workspaceSlug: slug },
        select: {
          id: true,
          name: true,
          emailAddress: true,
          emailBisonSenderId: true,
          emailSenderName: true,
          channel: true,
          status: true,
        },
      });

      // Build lookup maps
      const byEbId = new Map<number, (typeof existingSenders)[0]>();
      const byEmail = new Map<string, (typeof existingSenders)[0]>();
      for (const s of existingSenders) {
        if (s.emailBisonSenderId) byEbId.set(s.emailBisonSenderId, s);
        if (s.emailAddress) byEmail.set(s.emailAddress.toLowerCase(), s);
      }

      // Track all EB inbox IDs seen from the API for stale detection
      const liveEbIds = new Set<number>();

      // Helper: determine updated channel when adding email capability to an existing sender
      const mergedChannel = (existing: (typeof existingSenders)[0]) =>
        existing.channel === "linkedin" ? "both" : existing.channel;

      let workspaceCreated = 0;
      let workspaceSynced = 0;
      let workspaceUnchanged = 0;

      for (const senderEmail of senderEmails) {
        liveEbIds.add(senderEmail.id);
        const emailKey = senderEmail.email.toLowerCase();
        const trimmedSenderName = senderEmail.name?.trim();
        const normalizedSenderName = trimmedSenderName || senderEmail.email;

        // Priority 1: match by emailBisonSenderId (most reliable)
        const matchedByEbId = byEbId.get(senderEmail.id);
        if (matchedByEbId) {
          const newChannel = mergedChannel(matchedByEbId);
          const needsUpdate =
            matchedByEbId.emailAddress?.toLowerCase() !== emailKey ||
            (trimmedSenderName &&
              matchedByEbId.emailSenderName !== trimmedSenderName) ||
            matchedByEbId.channel !== newChannel ||
            matchedByEbId.status === "deactivated";

          if (needsUpdate) {
            await prisma.sender.update({
              where: { id: matchedByEbId.id },
              data: {
                emailAddress: senderEmail.email,
                channel: newChannel,
                ...(trimmedSenderName
                  ? { emailSenderName: trimmedSenderName }
                  : {}),
                // Reactivate if it was previously deactivated but now exists in EB again
                ...(matchedByEbId.status === "deactivated" ? { status: "active" } : {}),
              },
            });
            console.log(`[sync-senders] ${slug}: updated sender by EB ID ${senderEmail.id} -- ${senderEmail.email}`);
            workspaceSynced++;
          } else {
            workspaceUnchanged++;
          }
          result.synced++;
          continue;
        }

        // Priority 2: match by email address
        const matchedByEmail = byEmail.get(emailKey);
        if (matchedByEmail) {
          const newChannel = mergedChannel(matchedByEmail);
          const needsUpdate =
            matchedByEmail.emailBisonSenderId !== senderEmail.id ||
            (trimmedSenderName &&
              matchedByEmail.emailSenderName !== trimmedSenderName) ||
            matchedByEmail.channel !== newChannel ||
            matchedByEmail.status === "deactivated";

          if (needsUpdate) {
            await prisma.sender.update({
              where: { id: matchedByEmail.id },
              data: {
                emailBisonSenderId: senderEmail.id,
                channel: newChannel,
                ...(trimmedSenderName
                  ? { emailSenderName: trimmedSenderName }
                  : {}),
                ...(matchedByEmail.status === "deactivated" ? { status: "active" } : {}),
              },
            });
            console.log(`[sync-senders] ${slug}: updated sender by email -- ${senderEmail.email}`);
            workspaceSynced++;
          } else {
            workspaceUnchanged++;
          }
          result.synced++;
          continue;
        }

        // No match -- create new Sender record (one per EB inbox)
        await prisma.sender.create({
          data: {
            workspaceSlug: slug,
            name: normalizedSenderName,
            emailAddress: senderEmail.email,
            emailBisonSenderId: senderEmail.id,
            channel: "email",
            ...(trimmedSenderName
              ? { emailSenderName: trimmedSenderName }
              : {}),
            status: "active",
          },
        });
        console.log(`[sync-senders] ${slug}: created new sender -- ${senderEmail.email}`);
        workspaceCreated++;
        result.created++;
      }

      // Stale sender cleanup: deactivate senders whose EB inbox no longer exists
      const staleSenders = existingSenders.filter(
        (s) =>
          s.emailBisonSenderId !== null &&
          s.emailBisonSenderId !== undefined &&
          !liveEbIds.has(s.emailBisonSenderId) &&
          s.status !== "deactivated",
      );

      if (staleSenders.length > 0) {
        await prisma.sender.updateMany({
          where: { id: { in: staleSenders.map((s) => s.id) } },
          data: { status: "deactivated" },
        });

        for (const stale of staleSenders) {
          console.warn(
            `[sync-senders] ${slug}: deactivated stale sender -- ${stale.emailAddress ?? stale.name} (EB ID ${stale.emailBisonSenderId} no longer exists)`,
          );
        }

        result.deactivated += staleSenders.length;
      }

      console.log(
        `[sync-senders] ${slug}: ${workspaceCreated} created, ${workspaceSynced} updated, ${workspaceUnchanged} unchanged, ${staleSenders.length} deactivated`,
      );
    } catch (error) {
      const msg = `${slug}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[sync-senders] Error processing workspace ${slug}:`, error);
      result.errors.push(msg);
    }
  }

  console.log(
    `[sync-senders] Done: ${result.workspaces} workspaces, ${result.synced} synced, ${result.created} created, ${result.deactivated} deactivated, ${result.skipped} skipped, ${result.errors.length} errors`,
  );

  return result;
}
