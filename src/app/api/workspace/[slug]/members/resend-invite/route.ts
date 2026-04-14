import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createInviteAndSendEmail } from "@/lib/member-invite";

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * POST /api/workspace/[slug]/members/resend-invite
 *
 * Resend an invitation email to a member with status "invited".
 * Generates a new MagicLinkToken and sends a fresh email.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext,
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const body = await request.json();
  const email = (body.email ?? "").trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const member = await prisma.member.findUnique({
    where: { email_workspaceSlug: { email, workspaceSlug: slug } },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  if (member.status === "active") {
    return NextResponse.json(
      { error: "Member is already active" },
      { status: 400 },
    );
  }

  if (member.status === "disabled") {
    return NextResponse.json(
      { error: "Member is disabled. Re-enable them first." },
      { status: 400 },
    );
  }

  try {
    await createInviteAndSendEmail(email, slug, workspace.name);
  } catch (err) {
    console.error("Failed to resend invite email:", err);
    return NextResponse.json(
      { error: "Failed to send invitation email" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, message: "Invitation resent" });
}
