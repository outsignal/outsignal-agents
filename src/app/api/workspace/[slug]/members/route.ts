import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { createInviteAndSendEmail } from "@/lib/member-invite";

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
