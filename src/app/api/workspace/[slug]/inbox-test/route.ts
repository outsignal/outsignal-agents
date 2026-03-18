import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { emailguard } from "@/lib/emailguard/client";

type RouteContext = { params: Promise<{ slug: string }> };

// ---------------------------------------------------------------------------
// GET — list inbox test results
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: RouteContext) {
  const admin = await requireAdminAuth();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.EMAILGUARD_API_TOKEN) {
    return NextResponse.json({ available: false });
  }

  const { slug } = await ctx.params;

  // Verify workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const tests = await emailguard.listInboxTests();
    return NextResponse.json({ available: true, tests });
  } catch (err) {
    console.error("[inbox-test] Error listing tests:", err);
    return NextResponse.json(
      {
        available: true,
        tests: [],
        error: err instanceof Error ? err.message : "Failed to fetch tests",
      },
      { status: 200 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — trigger a new inbox placement test
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, ctx: RouteContext) {
  const admin = await requireAdminAuth();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.EMAILGUARD_API_TOKEN) {
    return NextResponse.json(
      { error: "EmailGuard not configured" },
      { status: 503 },
    );
  }

  const { slug } = await ctx.params;

  // Verify workspace exists
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const body = (await req.json()) as {
      subject?: string;
      body?: string;
      from_email?: string;
    };

    if (!body.subject || !body.body || !body.from_email) {
      return NextResponse.json(
        { error: "subject, body, and from_email are required" },
        { status: 400 },
      );
    }

    const test = await emailguard.createInboxTest({
      subject: body.subject,
      body: body.body,
      from_email: body.from_email,
    });

    return NextResponse.json({ test });
  } catch (err) {
    console.error("[inbox-test] Error creating test:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create test" },
      { status: 500 },
    );
  }
}
