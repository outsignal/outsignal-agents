import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

type RouteContext = { params: Promise<{ slug: string }> };

// ---------- helpers ----------

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((e: string) => e.trim().toLowerCase()) : [];
  } catch {
    return [];
  }
}

function serializeJsonArray(arr: string[]): string {
  return JSON.stringify(arr);
}

interface MemberRow {
  email: string;
  role: "client";
  portalAccess: boolean;
  notifications: boolean;
  lastLogin: string | null;
  status: "active" | "invited" | "never_logged_in";
}

async function buildMemberList(slug: string): Promise<MemberRow[]> {
  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) return [];

  const clientEmails = parseJsonArray(workspace.clientEmails);
  const notificationEmails = parseJsonArray(workspace.notificationEmails);

  if (clientEmails.length === 0) return [];

  // Fetch all magic link tokens for these emails + workspace in one query
  const tokens = await prisma.magicLinkToken.findMany({
    where: {
      workspaceSlug: slug,
      email: { in: clientEmails },
    },
    orderBy: { createdAt: "desc" },
  });

  // Group tokens by email
  const tokensByEmail = new Map<string, typeof tokens>();
  for (const t of tokens) {
    const key = t.email.toLowerCase();
    if (!tokensByEmail.has(key)) tokensByEmail.set(key, []);
    tokensByEmail.get(key)!.push(t);
  }

  return clientEmails.map((email) => {
    const emailTokens = tokensByEmail.get(email) ?? [];
    const usedTokens = emailTokens.filter((t) => t.used);
    const hasAnyToken = emailTokens.length > 0;
    const hasUsedToken = usedTokens.length > 0;

    // Use createdAt of the most recent used token as proxy for last login
    const lastUsed = hasUsedToken ? usedTokens[0].createdAt : null;

    let status: MemberRow["status"] = "never_logged_in";
    if (hasUsedToken) status = "active";
    else if (hasAnyToken) status = "invited";

    return {
      email,
      role: "client" as const,
      portalAccess: true,
      notifications: notificationEmails.includes(email),
      lastLogin: lastUsed ? lastUsed.toISOString() : null,
      status,
    };
  });
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

  const members = await buildMemberList(slug);
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

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const clientEmails = parseJsonArray(workspace.clientEmails);
  if (clientEmails.includes(email)) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }

  clientEmails.push(email);

  // Also add to notification emails by default
  const notificationEmails = parseJsonArray(workspace.notificationEmails);
  if (!notificationEmails.includes(email)) {
    notificationEmails.push(email);
  }

  await prisma.workspace.update({
    where: { slug },
    data: {
      clientEmails: serializeJsonArray(clientEmails),
      notificationEmails: serializeJsonArray(notificationEmails),
    },
  });

  const members = await buildMemberList(slug);
  return NextResponse.json({ members });
}

// ---------- DELETE: remove a member ----------

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

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const clientEmails = parseJsonArray(workspace.clientEmails).filter((e) => e !== email);
  const notificationEmails = parseJsonArray(workspace.notificationEmails).filter((e) => e !== email);

  await prisma.workspace.update({
    where: { slug },
    data: {
      clientEmails: clientEmails.length > 0 ? serializeJsonArray(clientEmails) : null,
      notificationEmails: notificationEmails.length > 0 ? serializeJsonArray(notificationEmails) : null,
    },
  });

  const members = await buildMemberList(slug);
  return NextResponse.json({ members });
}

// ---------- PATCH: toggle notification preference ----------

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
  const notifications = body.notifications as boolean;

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  if (typeof notifications !== "boolean") {
    return NextResponse.json({ error: "notifications must be a boolean" }, { status: 400 });
  }

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const notificationEmails = parseJsonArray(workspace.notificationEmails);

  if (notifications && !notificationEmails.includes(email)) {
    notificationEmails.push(email);
  } else if (!notifications) {
    const idx = notificationEmails.indexOf(email);
    if (idx !== -1) notificationEmails.splice(idx, 1);
  }

  await prisma.workspace.update({
    where: { slug },
    data: {
      notificationEmails: notificationEmails.length > 0 ? serializeJsonArray(notificationEmails) : null,
    },
  });

  const members = await buildMemberList(slug);
  return NextResponse.json({ members });
}
