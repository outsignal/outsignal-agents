import { prisma } from "@/lib/db";
import { EmailBisonClient } from "@/lib/emailbison/client";

export interface InboxStatusChange {
  workspaceSlug: string;
  workspaceName: string;
  newDisconnections: string[];
  persistentDisconnections: string[];
  reconnections: string[];
  totalDisconnected: number;
  totalConnected: number;
}

export async function checkAllWorkspaces(): Promise<InboxStatusChange[]> {
  // Get all workspaces with API tokens
  const workspaces = await prisma.workspace.findMany({
    where: { apiToken: { not: null }, monitoringEnabled: true },
    select: { slug: true, name: true, apiToken: true },
  });

  const results: InboxStatusChange[] = [];

  for (const ws of workspaces) {
    if (!ws.apiToken) continue;
    try {
      const result = await checkWorkspace(ws.slug, ws.name, ws.apiToken);
      if (result) results.push(result);
    } catch (err) {
      console.error(`[inbox-health] Failed to check workspace ${ws.slug}:`, err);
    }
  }

  return results;
}

async function checkWorkspace(
  slug: string,
  name: string,
  apiToken: string,
): Promise<InboxStatusChange | null> {
  const client = new EmailBisonClient(apiToken);
  const senderEmails = await client.getSenderEmails();

  // Build current status map
  const currentStatuses: Record<string, string> = {};
  for (const sender of senderEmails) {
    currentStatuses[sender.email] = sender.status ?? "Unknown";
  }

  // Load previous snapshot
  const previous = await prisma.inboxStatusSnapshot.findUnique({
    where: { workspaceSlug: slug },
  });

  const prevStatuses: Record<string, string> = previous
    ? JSON.parse(previous.statuses)
    : {};
  const prevDisconnected: string[] = previous
    ? JSON.parse(previous.disconnectedEmails)
    : [];

  // Compute diffs
  const newDisconnections: string[] = [];
  const persistentDisconnections: string[] = [];
  const reconnections: string[] = [];
  const currentDisconnected: string[] = [];

  for (const [email, status] of Object.entries(currentStatuses)) {
    if (status !== "Connected") {
      currentDisconnected.push(email);
      if (previous) {
        const prevStatus = prevStatuses[email];
        if (prevStatus === "Connected" || prevStatus === undefined) {
          // Was connected (or new) last time, now disconnected
          newDisconnections.push(email);
        } else if (prevDisconnected.includes(email)) {
          // Was already disconnected last check and still is
          persistentDisconnections.push(email);
        }
      }
    } else {
      // Currently connected — was it previously disconnected?
      if (prevDisconnected.includes(email)) {
        reconnections.push(email);
      }
    }
  }

  // Upsert snapshot
  await prisma.inboxStatusSnapshot.upsert({
    where: { workspaceSlug: slug },
    create: {
      workspaceSlug: slug,
      statuses: JSON.stringify(currentStatuses),
      disconnectedEmails: JSON.stringify(currentDisconnected),
    },
    update: {
      statuses: JSON.stringify(currentStatuses),
      disconnectedEmails: JSON.stringify(currentDisconnected),
      checkedAt: new Date(),
    },
  });

  // Return if there are any disconnected inboxes or reconnections to report
  if (
    newDisconnections.length === 0 &&
    persistentDisconnections.length === 0 &&
    reconnections.length === 0
  ) {
    return null;
  }

  const totalConnected = senderEmails.filter(
    (s) => (s.status ?? "Unknown") === "Connected",
  ).length;

  return {
    workspaceSlug: slug,
    workspaceName: name,
    newDisconnections,
    persistentDisconnections,
    reconnections,
    totalDisconnected: currentDisconnected.length,
    totalConnected,
  };
}
