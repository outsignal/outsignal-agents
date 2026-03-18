import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { prisma } from "@/lib/db";

// POST /api/lists/[id]/verify — create a contact verification job for list emails
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.EMAILGUARD_API_TOKEN) {
    return NextResponse.json({ available: false });
  }

  try {
    const { id } = await params;

    const list = await prisma.targetList.findUnique({
      where: { id },
      select: { id: true, name: true },
    });

    if (!list) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fetch all emails from the list's people
    const members = await prisma.targetListPerson.findMany({
      where: { listId: id },
      select: {
        person: {
          select: { email: true },
        },
      },
    });

    const emails = members
      .map((m) => m.person.email)
      .filter((e): e is string => Boolean(e));

    if (emails.length === 0) {
      return NextResponse.json(
        { error: "No emails to verify in this list" },
        { status: 400 },
      );
    }

    const { emailguard } = await import("@/lib/emailguard/client");
    const result = await emailguard.createContactVerification({
      name: `${list.name} - ${new Date().toISOString().slice(0, 10)}`,
      emails,
    });

    return NextResponse.json({
      available: true,
      verificationId: result.id,
      status: result.status,
      total: result.total,
    });
  } catch (err) {
    console.error("[POST /api/lists/[id]/verify] Error:", err);
    return NextResponse.json(
      { error: "Failed to create verification" },
      { status: 500 },
    );
  }
}

// GET /api/lists/[id]/verify?verificationId=123 — check verification status
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.EMAILGUARD_API_TOKEN) {
    return NextResponse.json({ available: false });
  }

  try {
    const { id } = await params;

    // Verify the list exists
    const list = await prisma.targetList.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!list) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const verificationId = searchParams.get("verificationId");

    if (!verificationId) {
      return NextResponse.json(
        { error: "verificationId query parameter is required" },
        { status: 400 },
      );
    }

    const { emailguard } = await import("@/lib/emailguard/client");
    const result = await emailguard.getContactList(verificationId);

    return NextResponse.json({
      available: true,
      verificationId: result.id,
      name: result.name,
      status: result.status,
      total: result.total,
      verified: result.verified,
      invalid: result.invalid,
    });
  } catch (err) {
    console.error("[GET /api/lists/[id]/verify] Error:", err);
    return NextResponse.json(
      { error: "Failed to check verification status" },
      { status: 500 },
    );
  }
}
