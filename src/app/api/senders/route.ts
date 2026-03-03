import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";

/**
 * GET /api/senders?workspace=rise
 * Returns all senders across all workspaces with workspace name included.
 * Accepts optional `workspace` query param to filter by slug.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceSlug = request.nextUrl.searchParams.get("workspace");

    const senders = await prisma.sender.findMany({
      where: workspaceSlug ? { workspaceSlug } : undefined,
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
    const sanitized = senders.map(({ sessionData, linkedinPassword, totpSecret, ...rest }) => rest);

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
  try {
    const body = await request.json();

    const { workspaceSlug, name, emailAddress, linkedinProfileUrl, linkedinEmail, proxyUrl, linkedinTier, dailyConnectionLimit, dailyMessageLimit, dailyProfileViewLimit } = body;

    if (!workspaceSlug || !name) {
      return NextResponse.json(
        { error: "workspaceSlug and name are required" },
        { status: 400 }
      );
    }

    // Validate workspace exists
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: `Workspace '${workspaceSlug}' not found` },
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

    const { sessionData, linkedinPassword, totpSecret, ...sanitized } = sender;
    return NextResponse.json({ sender: sanitized }, { status: 201 });
  } catch (error) {
    console.error("Create sender error:", error);
    return NextResponse.json({ error: "Failed to create sender" }, { status: 500 });
  }
}
