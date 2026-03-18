import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";

type RouteContext = { params: Promise<{ slug: string }> };

// ---------- helpers ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_ORDER: Record<string, number> = { owner: 0, admin: 1, viewer: 2 };

/** Fetch all members for a workspace, sorted by role priority then name. */
async function fetchSortedMembers(slug: string) {
  const members = await prisma.member.findMany({
    where: { workspaceSlug: slug },
    orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
  });
  members.sort((a, b) => {
    const ra = ROLE_ORDER[a.role] ?? 99;
    const rb = ROLE_ORDER[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    const nameA = a.name ?? a.email;
    const nameB = b.name ?? b.email;
    return nameA.localeCompare(nameB);
  });
  return members;
}

async function createInviteAndSendEmail(
  email: string,
  workspaceSlug: string,
  workspaceName: string,
) {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await prisma.magicLinkToken.create({
    data: { token, email, workspaceSlug, expiresAt },
  });

  const safeName = workspaceName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const baseUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : (process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai");
  const verifyUrl = `${baseUrl}/api/portal/verify?token=${token}`;

  await audited(
    {
      notificationType: "magic_link",
      channel: "email",
      recipient: email,
      workspaceSlug,
    },
    () =>
      sendNotificationEmail({
        to: [email],
        subject: `You've been invited to ${safeName} — Outsignal`,
        html: emailLayout({
          body: `
            <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">You're invited to join</h1>
            <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#635BFF;line-height:1.3;">${safeName}</p>
            <p style="margin:0 0 32px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">Your outreach dashboard is ready. Accept your invitation to get started with Outsignal.</p>
            ${emailButton("Accept Invitation", verifyUrl)}
            <div style="height:32px;"></div>
            <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
            <p style="margin:0 0 14px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;color:#2F2F2F;text-transform:uppercase;letter-spacing:1.5px;">What you'll get access to</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td style="padding:6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6B6B6B;line-height:1.6;"><span style="color:#635BFF;font-weight:700;padding-right:10px;">&#10003;</span>Track campaign performance and reply activity in real time</td></tr>
              <tr><td style="padding:6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6B6B6B;line-height:1.6;"><span style="color:#635BFF;font-weight:700;padding-right:10px;">&#10003;</span>Monitor sender health and deliverability across all domains</td></tr>
              <tr><td style="padding:6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#6B6B6B;line-height:1.6;"><span style="color:#635BFF;font-weight:700;padding-right:10px;">&#10003;</span>Manage your outreach pipeline from a single dashboard</td></tr>
            </table>
            <div style="height:24px;"></div>
            ${emailNotice('This invitation link expires in <strong style="color:#2F2F2F;">30 minutes</strong>. If you didn\'t expect this email, you can safely ignore it.')}
          `,
          footerNote: `This is a one-time invitation link for your ${safeName} dashboard.`,
        }),
      }),
  );
}

// ---------- GET: list members ----------

export async function GET(
  _request: NextRequest,
  { params }: RouteContext,
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const members = await fetchSortedMembers(slug);
  return NextResponse.json({ members });
}

// ---------- POST: add a member ----------

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
  const name = body.name?.trim() || undefined;
  const role = body.role ?? "viewer";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  if (!["owner", "admin", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role. Must be owner, admin, or viewer" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Check for existing member (@@unique constraint)
  const existing = await prisma.member.findUnique({
    where: { email_workspaceSlug: { email, workspaceSlug: slug } },
  });

  if (existing) {
    return NextResponse.json(
      { error: "Member already exists in this workspace" },
      { status: 409 },
    );
  }

  await prisma.member.create({
    data: {
      email,
      name,
      role,
      workspaceSlug: slug,
      status: "invited",
      invitedBy: session.email ?? undefined,
    },
  });

  // Send invitation email
  try {
    await createInviteAndSendEmail(email, slug, workspace.name);
  } catch (err) {
    console.error("Failed to send invite email:", err);
    // Member was created — don't fail the request, they can resend later
  }

  const members = await fetchSortedMembers(slug);
  return NextResponse.json({ members });
}

// ---------- PATCH: update member ----------

export async function PATCH(
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

  const member = await prisma.member.findUnique({
    where: { email_workspaceSlug: { email, workspaceSlug: slug } },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (!["owner", "admin", "viewer"].includes(body.role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    updateData.role = body.role;
  }

  if (body.notificationsEnabled !== undefined) {
    if (typeof body.notificationsEnabled !== "boolean") {
      return NextResponse.json({ error: "notificationsEnabled must be a boolean" }, { status: 400 });
    }
    updateData.notificationsEnabled = body.notificationsEnabled;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await prisma.member.update({
    where: { email_workspaceSlug: { email, workspaceSlug: slug } },
    data: updateData,
  });

  const members = await fetchSortedMembers(slug);
  return NextResponse.json({ members });
}

// ---------- DELETE: disable member ----------

export async function DELETE(
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

  const member = await prisma.member.findUnique({
    where: { email_workspaceSlug: { email, workspaceSlug: slug } },
  });

  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  await prisma.member.update({
    where: { email_workspaceSlug: { email, workspaceSlug: slug } },
    data: { status: "disabled" },
  });

  const members = await fetchSortedMembers(slug);
  return NextResponse.json({ members });
}

export { createInviteAndSendEmail };
