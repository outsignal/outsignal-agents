import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseJsonBody } from "@/lib/parse-json";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { encrypt } from "@/lib/crypto";
import { auditLog } from "@/lib/audit";

const adminCreateSenderSchema = z.object({
  workspaceSlug: z.string().min(1),
  name: z.string().min(1),
  emailAddress: z.string().email().optional().or(z.literal("")),
  linkedinProfileUrl: z.string().url().optional().or(z.literal("")),
  linkedinEmail: z.string().email().optional().or(z.literal("")),
  linkedinPassword: z.string().optional().or(z.literal("")),
  loginMethod: z
    .enum(["credentials", "infinite", "extension", "none"])
    .default("credentials"),
  linkedinTier: z.enum(["free", "premium"]).default("free"),
  proxyUrl: z.string().optional().or(z.literal("")),
  totpSecret: z.string().optional().or(z.literal("")),
});

/** Helper: convert empty strings to undefined */
function emptyToUndefined(val: string | undefined): string | undefined {
  return val && val.length > 0 ? val : undefined;
}

/**
 * POST /api/admin/senders
 * Creates a new sender with LinkedIn credential encryption.
 */
export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;

    const result = adminCreateSenderSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const {
      workspaceSlug,
      name,
      emailAddress,
      linkedinProfileUrl,
      linkedinEmail,
      linkedinPassword,
      loginMethod,
      linkedinTier,
      proxyUrl,
      totpSecret,
    } = result.data;

    // Validate workspace exists
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 400 },
      );
    }

    // Encrypt sensitive fields (only if non-empty)
    const cleanPassword = emptyToUndefined(linkedinPassword);
    const cleanTotp = emptyToUndefined(totpSecret);
    const encryptedPassword = cleanPassword ? encrypt(cleanPassword) : undefined;
    const encryptedTotp = cleanTotp ? encrypt(cleanTotp) : undefined;

    const channel = (emptyToUndefined(linkedinProfileUrl) || loginMethod !== "none") ? "linkedin" : "email";

    const sender = await prisma.sender.create({
      data: {
        workspaceSlug,
        name,
        inviteToken: randomUUID(),
        channel,
        sessionStatus: "not_setup",
        status: "setup",
        healthStatus: "healthy",
        warmupDay: 0,
        dailyConnectionLimit: 5,
        dailyMessageLimit: 10,
        dailyProfileViewLimit: 15,
        loginMethod,
        linkedinTier,
        ...(emptyToUndefined(emailAddress) && { emailAddress: emptyToUndefined(emailAddress) }),
        ...(emptyToUndefined(linkedinProfileUrl) && { linkedinProfileUrl: emptyToUndefined(linkedinProfileUrl) }),
        ...(emptyToUndefined(linkedinEmail) && { linkedinEmail: emptyToUndefined(linkedinEmail) }),
        ...(encryptedPassword && { linkedinPassword: encryptedPassword }),
        ...(emptyToUndefined(proxyUrl) && { proxyUrl: emptyToUndefined(proxyUrl) }),
        ...(encryptedTotp && { totpSecret: encryptedTotp }),
      },
      include: {
        workspace: {
          select: { name: true },
        },
      },
    });

    auditLog({
      action: "sender.create",
      entityType: "Sender",
      entityId: sender.id,
      adminEmail: session.email,
      metadata: { name, workspaceSlug, emailAddress: emptyToUndefined(emailAddress), loginMethod },
    });

    // Strip sensitive fields before returning
    const { sessionData, linkedinPassword: _pw, totpSecret: _totp, inviteToken, ...sanitized } = sender;
    return NextResponse.json({ sender: sanitized }, { status: 201 });
  } catch (error) {
    console.error("Admin create sender error:", error);
    return NextResponse.json(
      { error: "Failed to create sender" },
      { status: 500 },
    );
  }
}
