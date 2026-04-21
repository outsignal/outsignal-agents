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
      name: name.trim(),
      channel: "linkedin",
      status: "setup",
      loginMethod: "credentials",
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
    // Look up sender's proxy URL for geo-matching
    const sender = await prisma.sender.findUnique({
      where: { id: senderId },
      select: { proxyUrl: true },
    });

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
        proxyUrl: sender?.proxyUrl ?? undefined,
      }),
    });

    const responseText = await response.text();
    let result: { success: boolean; error?: string };
    try {
      result = JSON.parse(responseText);
    } catch {
      return {
        success: false,
        error: `Worker returned unexpected response (HTTP ${response.status})`,
      };
    }

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
 * Provision an IPRoyal residential proxy for a sender.
 * Calls the internal provision API with the server-side API_SECRET.
 */
export async function provisionProxy(
  senderId: string,
  country?: string,
): Promise<{ success: boolean; error?: string }> {
  const apiSecret = process.env.API_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  if (!apiSecret) {
    return { success: false, error: "API_SECRET not configured" };
  }

  try {
    const response = await fetch(`${baseUrl}/api/iproyal/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiSecret,
      },
      body: JSON.stringify({ senderId, country }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `Provisioning failed (${response.status})`,
      };
    }

    revalidatePath("/workspace");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to provision proxy",
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
