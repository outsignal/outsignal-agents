/**
 * GET /api/platform-costs
 * Returns all platform cost records with aggregations.
 * Seeds ~25 entries on first call if table is empty.
 *
 * PUT /api/platform-costs
 * Updates a single platform cost record (monthlyCost, notes).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";

// ---------------------------------------------------------------------------
// Seed data (~25 services)
// ---------------------------------------------------------------------------

const SEED_DATA: Array<{
  service: string;
  label: string;
  monthlyCost: number;
  category: string;
  client?: string;
  notes?: string;
  url?: string;
}> = [
  // TOOLS
  { service: "slack", label: "Slack", monthlyCost: 8.40, category: "tools" },
  { service: "google-workspace", label: "Google Workspace (Melhu)", monthlyCost: 14.00, category: "tools", client: "melhu" },
  { service: "google-workspace", label: "Google Workspace (Outsignal)", monthlyCost: 28.00, category: "tools", client: "outsignal" },
  { service: "claude-ai", label: "Claude AI", monthlyCost: 18.00, category: "tools", notes: "Pro plan" },
  { service: "framer", label: "Framer", monthlyCost: 18.00, category: "tools", notes: "Website builder" },
  { service: "loom", label: "Loom", monthlyCost: 13.71, category: "tools" },
  { service: "sketch", label: "Sketch", monthlyCost: 13.69, category: "tools" },
  { service: "upwork", label: "Upwork", monthlyCost: 18.61, category: "tools", notes: "Freelancer fees" },

  // API
  { service: "leadmagic", label: "LeadMagic", monthlyCost: 44.42, category: "api" },
  { service: "prospeo", label: "Prospeo", monthlyCost: 36.01, category: "api" },
  { service: "clay", label: "Clay", monthlyCost: 266.31, category: "api", notes: "Cancelling soon" },
  { service: "apify", label: "Apify", monthlyCost: 23.00, category: "api", notes: "Starter plan", url: "https://console.apify.com" },
  { service: "anthropic-api", label: "Anthropic API", monthlyCost: 0, category: "api", notes: "Pay-per-use", url: "https://console.anthropic.com" },

  // EMAIL
  { service: "cheapinboxes", label: "CheapInboxes (YoopKnows)", monthlyCost: 34.37, category: "email", client: "yoopknows" },
  { service: "cheapinboxes", label: "CheapInboxes (Rise)", monthlyCost: 52.03, category: "email", client: "rise", notes: "4 charges combined" },
  { service: "cheapinboxes", label: "CheapInboxes (StingBox)", monthlyCost: 52.94, category: "email", client: "stingbox" },
  { service: "cheapinboxes", label: "CheapInboxes (Lime)", monthlyCost: 51.11, category: "email", client: "lime-recruitment" },
  { service: "cheapinboxes", label: "CheapInboxes (MyAcq)", monthlyCost: 51.11, category: "email", client: "myacq" },
  { service: "cheapinboxes", label: "CheapInboxes (Outsignal)", monthlyCost: 68.15, category: "email", client: "outsignal" },
  { service: "emailbison", label: "EmailBison", monthlyCost: 378.12, category: "email", notes: "White-label" },
  { service: "resend", label: "Resend", monthlyCost: 0, category: "email", notes: "Free tier" },

  // INFRASTRUCTURE
  { service: "vercel", label: "Vercel", monthlyCost: 16.00, category: "infrastructure", notes: "Pro plan", url: "https://vercel.com/dashboard" },
  { service: "trigger-dev", label: "Trigger.dev", monthlyCost: 0, category: "infrastructure", notes: "Free tier", url: "https://cloud.trigger.dev" },
  { service: "neon", label: "Neon", monthlyCost: 0, category: "infrastructure", notes: "Free tier", url: "https://console.neon.tech" },
  { service: "railway", label: "Railway", monthlyCost: 5.00, category: "infrastructure", notes: "LinkedIn worker", url: "https://railway.app/dashboard" },
];

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let services = await prisma.platformCost.findMany({
      orderBy: [{ category: "asc" }, { client: "asc" }, { label: "asc" }],
    });

    // Seed if empty
    if (services.length === 0) {
      await prisma.platformCost.createMany({
        data: SEED_DATA.map((item) => ({
          service: item.service,
          label: item.label,
          monthlyCost: item.monthlyCost,
          category: item.category,
          client: item.client ?? null,
          notes: item.notes ?? null,
          url: item.url ?? null,
        })),
      });

      services = await prisma.platformCost.findMany({
        orderBy: [{ category: "asc" }, { client: "asc" }, { label: "asc" }],
      });
    }

    // Aggregations
    const totalMonthly = services.reduce((sum, s) => sum + s.monthlyCost, 0);

    const byCategory: Record<string, number> = {};
    const byClient: Record<string, number> = {};

    for (const s of services) {
      byCategory[s.category] = (byCategory[s.category] ?? 0) + s.monthlyCost;

      const clientKey = s.client ?? "shared";
      byClient[clientKey] = (byClient[clientKey] ?? 0) + s.monthlyCost;
    }

    return NextResponse.json({
      services,
      totalMonthly,
      byCategory,
      byClient,
    });
  } catch (error) {
    console.error("[platform-costs] Failed to fetch:", error);
    return NextResponse.json(
      { error: "Failed to fetch platform costs" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, monthlyCost, notes } = body as {
      id: string;
      monthlyCost?: number;
      notes?: string;
    };

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    if (monthlyCost !== undefined && (typeof monthlyCost !== "number" || monthlyCost < 0)) {
      return NextResponse.json(
        { error: "monthlyCost must be a non-negative number" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (monthlyCost !== undefined) updateData.monthlyCost = monthlyCost;
    if (notes !== undefined) updateData.notes = notes;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const updated = await prisma.platformCost.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[platform-costs] Failed to update:", error);
    return NextResponse.json(
      { error: "Failed to update platform cost" },
      { status: 500 }
    );
  }
}
