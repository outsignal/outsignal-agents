"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

const WORKER_URL = process.env.LINKEDIN_WORKER_URL;
const WORKER_SECRET = process.env.WORKER_API_SECRET;

/**
 * Create a new LinkedIn sender for a workspace.
 * Used from the client portal to let clients add their own accounts.
 */
export async function addLinkedInAccount(
  workspaceSlug: string,
  name: string,
): Promise<{ id: string }> {
  const sender = await prisma.sender.create({
    data: {
      workspaceSlug,
      name,
      status: "setup",
    },
  });

  revalidatePath("/portal/linkedin");
  return { id: sender.id };
}

/**
 * Start a VNC login session for a sender.
 * Calls the worker's session server to start Xvfb + Chromium + x11vnc.
 * Returns the login URL (noVNC viewer with auth token).
 */
export async function startLoginSession(
  senderId: string,
): Promise<{ loginUrl: string }> {
  if (!WORKER_URL || !WORKER_SECRET) {
    throw new Error("LinkedIn worker is not configured (missing LINKEDIN_WORKER_URL or WORKER_API_SECRET)");
  }

  const sender = await prisma.sender.findUnique({
    where: { id: senderId },
    select: { id: true, proxyUrl: true },
  });

  if (!sender) {
    throw new Error("Sender not found");
  }

  const response = await fetch(`${WORKER_URL}/sessions/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({
      senderId: sender.id,
      proxyUrl: sender.proxyUrl,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to start login session: ${body}`);
  }

  const data = await response.json();

  return {
    loginUrl: `${WORKER_URL}/login?token=${data.token}`,
  };
}

/**
 * Stop the active VNC login session.
 */
export async function stopLoginSession(senderId: string): Promise<void> {
  if (!WORKER_URL || !WORKER_SECRET) return;

  await fetch(`${WORKER_URL}/sessions/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WORKER_SECRET}`,
    },
    body: JSON.stringify({ senderId }),
  }).catch(() => {
    // Best effort — don't fail the UI
  });
}

/**
 * Get the current session status for a sender.
 * Used for polling after initiating a login.
 */
export async function getSessionStatus(
  senderId: string,
): Promise<{ status: string; lastActiveAt: Date | null } | null> {
  const sender = await prisma.sender.findUnique({
    where: { id: senderId },
    select: { sessionStatus: true, lastActiveAt: true },
  });

  if (!sender) return null;

  return {
    status: sender.sessionStatus,
    lastActiveAt: sender.lastActiveAt,
  };
}
