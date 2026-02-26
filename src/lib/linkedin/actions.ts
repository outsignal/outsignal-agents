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
 * Connect a LinkedIn account using headless login.
 * Calls the Railway worker to log in with credentials and capture cookies.
 */
export async function connectLinkedIn(
  senderId: string,
  method: "credentials" | "infinite",
  data: {
    email: string;
    password: string;
    totpSecret?: string;
    verificationCode?: string;
  },
): Promise<{ success: boolean; error?: string }> {
  if (!WORKER_URL || !WORKER_SECRET) {
    return {
      success: false,
      error: "LinkedIn worker is not configured",
    };
  }

  try {
    const response = await fetch(`${WORKER_URL}/sessions/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_SECRET}`,
      },
      body: JSON.stringify({
        senderId,
        email: data.email,
        password: data.password,
        totpSecret: method === "infinite" ? data.totpSecret : undefined,
        verificationCode: data.verificationCode,
      }),
    });

    const result = await response.json();

    if (result.success) {
      // Store encrypted credentials for future re-login
      const { encrypt } = await import("@/lib/crypto");
      const updateData: Record<string, string> = {
        linkedinEmail: data.email,
        linkedinPassword: encrypt(data.password),
        loginMethod: method,
      };

      if (data.totpSecret) {
        updateData.totpSecret = encrypt(data.totpSecret);
      }

      await prisma.sender.update({
        where: { id: senderId },
        data: updateData,
      });

      revalidatePath("/portal/linkedin");
    }

    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Get the current session status for a sender.
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
