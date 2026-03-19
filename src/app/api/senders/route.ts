import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { parseJsonBody } from "@/lib/parse-json";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createSenderSchema } from "@/lib/validations/senders";
import { auditLog } from "@/lib/audit";

/**
 * GET /api/senders?workspace=rise
 * Returns all senders across all workspaces with workspace name included.
 * Accepts optional `workspace` query param to filter by slug.
 */
export async function GET(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaceSlug = request.nextUrl.searchParams.get("workspace");

    const senders = await prisma.sender.findMany({
      where: {
        ...(workspaceSlug ? { workspaceSlug } : {}),
        emailBisonSenderId: null,
        OR: [{ linkedinProfileUrl: { not: null } }, { loginMethod: { not: "none" } }],
      },
      include: {
        workspace: {
          select: { name: true },
        },
      },
      orderBy: [{ workspaceSlug: "asc" }, { name: "asc" }],
    });

    // Lazily backfill inviteToken for senders that don't have one yet
    const backfillPromises = senders
      .filter((s) => !s.inviteToken)
      .map((s) =>
        prisma.sender.update({
          where: { id: s.id },
          data: { inviteToken: randomUUID() },
        }),
      );

    if (backfillPromises.length > 0) {
      const updated = await Promise.all(backfillPromises);
      // Patch the in-memory array so the response has the new tokens
      const tokenMap = new Map(updated.map((s) => [s.id, s.inviteToken]));
      for (const s of senders) {
        if (!s.inviteToken && tokenMap.has(s.id)) {
          s.inviteToken = tokenMap.get(s.id) ?? null;
        }
      }
    }

    // Strip sensitive fields before returning
    const sanitized = senders.map(({ sessionData, linkedinPassword, totpSecret, inviteToken, ...rest }) => rest);

    return NextResponse.json({ senders: sanitized });
  } catch (error) {
    console.error("List senders error:", error);
    return NextResponse.json({ error: "Failed to list senders" }, { status: 500 });
  }
}

/**
 * POST /api/senders
 * Creates a new sender. Required: workspaceSlug, name.
 */
export async function POST(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const result = createSenderSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, { status: 400 });
    }

    const { workspaceSlug, name, emailAddress, linkedinProfileUrl, linkedinEmail, proxyUrl, linkedinTier, dailyConnectionLimit, dailyMessageLimit, dailyProfileViewLimit } = result.data;

    // Validate workspace exists
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 400 }
      );
    }

    const sender = await prisma.sender.create({
      data: {
        workspaceSlug,
        name,
        inviteToken: randomUUID(),
        ...(emailAddress !== undefined && { emailAddress }),
        ...(linkedinProfileUrl !== undefined && { linkedinProfileUrl }),
        ...(linkedinEmail !== undefined && { linkedinEmail }),
        ...(proxyUrl !== undefined && { proxyUrl }),
        ...(linkedinTier !== undefined && { linkedinTier }),
        ...(dailyConnectionLimit !== undefined && { dailyConnectionLimit: Number(dailyConnectionLimit) }),
        ...(dailyMessageLimit !== undefined && { dailyMessageLimit: Number(dailyMessageLimit) }),
        ...(dailyProfileViewLimit !== undefined && { dailyProfileViewLimit: Number(dailyProfileViewLimit) }),
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
      metadata: { name, workspaceSlug, emailAddress },
    });

    const { sessionData, linkedinPassword, totpSecret, inviteToken, ...sanitized } = sender;
    return NextResponse.json({ sender: sanitized }, { status: 201 });
  } catch (error) {
    console.error("Create sender error:", error);
    return NextResponse.json({ error: "Failed to create sender" }, { status: 500 });
  }
}
