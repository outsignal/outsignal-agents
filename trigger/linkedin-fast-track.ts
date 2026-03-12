import { task } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { bumpPriority, enqueueAction } from "@/lib/linkedin/queue";
import { assignSenderForPerson } from "@/lib/linkedin/sender";

// PrismaClient at module scope — not inside run() (pattern from smoke-test.ts)
const prisma = new PrismaClient();

export interface LinkedinFastTrackPayload {
  personEmail: string;
  workspaceSlug: string;
  senderEmail: string | null;
  campaignName: string | null;
}

export const linkedinFastTrack = task({
  id: "linkedin-fast-track",
  // No queue — pure DB queries + LinkedIn action enqueue (no Anthropic or EmailBison)
  maxDuration: 30,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 5_000,
  },

  run: async (payload: LinkedinFastTrackPayload) => {
    const { personEmail, workspaceSlug, senderEmail, campaignName } = payload;

    // Step 1: Look up person by email — return early if no person or no LinkedIn URL
    const person = await prisma.person.findUnique({
      where: { email: personEmail },
      select: { id: true, linkedinUrl: true },
    });

    if (!person?.linkedinUrl) {
      console.log(
        `[linkedin-fast-track] No person or no linkedinUrl for ${personEmail} — skipping`,
      );
      return { skipped: true, reason: "no_linkedin_url" };
    }

    // Step 2: Try to bump existing pending connection to P1
    const bumped = await bumpPriority(person.id, workspaceSlug);

    if (bumped) {
      console.log(
        `[linkedin-fast-track] Bumped existing connect action to P1 for ${personEmail}`,
      );
      return { bumped: true, enqueued: false };
    }

    // Step 3: No existing action — check if already connected
    const existingConnection = await prisma.linkedInConnection.findFirst({
      where: { personId: person.id, sender: { workspaceSlug } },
      select: { status: true },
    });

    if (existingConnection && existingConnection.status !== "none") {
      console.log(
        `[linkedin-fast-track] Already connected (status=${existingConnection.status}) for ${personEmail} — skipping`,
      );
      return { skipped: true, reason: "already_connected" };
    }

    // Step 4: No connection or status "none" — find sender and enqueue P1 connect
    const sender = await assignSenderForPerson(workspaceSlug, {
      emailSenderAddress: senderEmail ?? undefined,
      mode: senderEmail ? "email_linkedin" : "linkedin_only",
    });

    if (!sender) {
      console.log(
        `[linkedin-fast-track] No active sender found for workspace ${workspaceSlug} — skipping`,
      );
      return { skipped: true, reason: "no_active_sender" };
    }

    const actionId = await enqueueAction({
      senderId: sender.id,
      personId: person.id,
      workspaceSlug,
      actionType: "connect",
      priority: 1,
      scheduledFor: new Date(), // ASAP
      campaignName: campaignName ?? undefined,
    });

    console.log(
      `[linkedin-fast-track] Enqueued P1 connect action ${actionId} for ${personEmail} via sender ${sender.id}`,
    );

    return { bumped: false, enqueued: true, actionId };
  },
});
