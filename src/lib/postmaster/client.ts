/**
 * Google Postmaster Tools API client.
 * Handles OAuth2 token management and API calls.
 */

import { google } from "googleapis";
import { prisma } from "@/lib/db";

const LOG_PREFIX = "[postmaster]";

const SCOPES = [
  "https://www.googleapis.com/auth/postmaster.readonly",
  "https://www.googleapis.com/auth/siteverification",
];

/**
 * Create an OAuth2 client configured with env vars.
 */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_POSTMASTER_CLIENT_ID,
    process.env.GOOGLE_POSTMASTER_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL || "https://admin.outsignal.ai"}/api/auth/google-postmaster/callback`
  );
}

/**
 * Generate the OAuth consent URL for one-time admin authorization.
 */
export function getAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force refresh token generation
  });
}

/**
 * Exchange an authorization code for tokens and store them.
 */
export async function handleCallback(code: string): Promise<void> {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new Error("No refresh token received. Re-authorize with prompt=consent.");
  }

  // Upsert — only one auth record needed
  const existing = await prisma.postmasterAuth.findFirst();

  if (existing) {
    await prisma.postmasterAuth.update({
      where: { id: existing.id },
      data: {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: SCOPES.join(" "),
      },
    });
  } else {
    await prisma.postmasterAuth.create({
      data: {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token ?? null,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        scopes: SCOPES.join(" "),
      },
    });
  }

  console.log(`${LOG_PREFIX} OAuth tokens stored successfully`);
}

/**
 * Get an authenticated Postmaster Tools API client.
 * Returns null if no auth is configured.
 */
export async function getPostmasterClient() {
  const auth = await prisma.postmasterAuth.findFirst();
  if (!auth) {
    console.warn(`${LOG_PREFIX} No Postmaster auth configured -- skipping`);
    return null;
  }

  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({
    refresh_token: auth.refreshToken,
    access_token: auth.accessToken ?? undefined,
    expiry_date: auth.expiresAt?.getTime(),
  });

  // Update stored access token after refresh
  oauth2Client.on("tokens", async (tokens) => {
    try {
      await prisma.postmasterAuth.update({
        where: { id: auth.id },
        data: {
          accessToken: tokens.access_token ?? null,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed to update access token:`, err);
    }
  });

  return google.gmailpostmastertools({ version: "v1", auth: oauth2Client });
}

/**
 * Check if Postmaster auth is configured and valid.
 */
export async function isPostmasterConfigured(): Promise<boolean> {
  const auth = await prisma.postmasterAuth.findFirst();
  return !!auth?.refreshToken;
}
