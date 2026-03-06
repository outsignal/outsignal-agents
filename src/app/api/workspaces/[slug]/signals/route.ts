import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { updateSignalsSchema } from "@/lib/validations/workspaces";

const VALID_SIGNAL_TYPES = [
  "job_change",
  "funding",
  "hiring_spike",
  "tech_adoption",
  "news",
  "social_mention",
] as const;

type ValidSignalType = (typeof VALID_SIGNAL_TYPES)[number];

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * GET /api/workspaces/[slug]/signals
 * Returns the 4 signal monitoring config fields for the workspace.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({
    signalDailyCapUsd: ws.signalDailyCapUsd,
    signalEnabledTypes: parseJsonArray(ws.signalEnabledTypes),
    signalCompetitors: parseJsonArray(ws.signalCompetitors),
    signalWatchlistDomains: parseJsonArray(ws.signalWatchlistDomains),
  });
}

/**
 * PATCH /api/workspaces/[slug]/signals
 * Update workspace signal monitoring configuration.
 * Body: { signalDailyCapUsd?, signalEnabledTypes?, signalCompetitors?, signalWatchlistDomains? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  const ws = await prisma.workspace.findUnique({ where: { slug } });
  if (!ws) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const parseResult = updateSignalsSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
    }
    const validated = parseResult.data;
    const updateData: Record<string, unknown> = {};

    // Validate signalDailyCapUsd
    if (validated.signalDailyCapUsd !== undefined) {
      const val = Number(validated.signalDailyCapUsd);
      if (!Number.isFinite(val) || val < 0) {
        return NextResponse.json(
          { error: "signalDailyCapUsd must be a number >= 0" },
          { status: 400 },
        );
      }
      updateData.signalDailyCapUsd = val;
    }

    // Validate signalEnabledTypes
    if (validated.signalEnabledTypes !== undefined) {
      if (!Array.isArray(validated.signalEnabledTypes)) {
        return NextResponse.json(
          { error: "signalEnabledTypes must be an array" },
          { status: 400 },
        );
      }
      const invalid = (validated.signalEnabledTypes as string[]).filter(
        (t) => !VALID_SIGNAL_TYPES.includes(t as ValidSignalType),
      );
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error: `Invalid signal types: ${invalid.join(", ")}. Valid values: ${VALID_SIGNAL_TYPES.join(", ")}`,
          },
          { status: 400 },
        );
      }
      updateData.signalEnabledTypes = JSON.stringify(validated.signalEnabledTypes);
    }

    // Validate signalCompetitors
    if (validated.signalCompetitors !== undefined) {
      if (!Array.isArray(validated.signalCompetitors)) {
        return NextResponse.json(
          { error: "signalCompetitors must be an array of strings" },
          { status: 400 },
        );
      }
      const hasNonString = (validated.signalCompetitors as unknown[]).some(
        (v) => typeof v !== "string",
      );
      if (hasNonString) {
        return NextResponse.json(
          { error: "signalCompetitors must be an array of strings" },
          { status: 400 },
        );
      }
      updateData.signalCompetitors = JSON.stringify(validated.signalCompetitors);
    }

    // Validate signalWatchlistDomains
    if (validated.signalWatchlistDomains !== undefined) {
      if (!Array.isArray(validated.signalWatchlistDomains)) {
        return NextResponse.json(
          { error: "signalWatchlistDomains must be an array of strings" },
          { status: 400 },
        );
      }
      const hasNonString = (validated.signalWatchlistDomains as unknown[]).some(
        (v) => typeof v !== "string",
      );
      if (hasNonString) {
        return NextResponse.json(
          { error: "signalWatchlistDomains must be an array of strings" },
          { status: 400 },
        );
      }
      updateData.signalWatchlistDomains = JSON.stringify(
        validated.signalWatchlistDomains,
      );
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    const updated = await prisma.workspace.update({
      where: { slug },
      data: updateData,
    });

    return NextResponse.json({
      signalDailyCapUsd: updated.signalDailyCapUsd,
      signalEnabledTypes: parseJsonArray(updated.signalEnabledTypes),
      signalCompetitors: parseJsonArray(updated.signalCompetitors),
      signalWatchlistDomains: parseJsonArray(updated.signalWatchlistDomains),
    });
  } catch (error) {
    console.error("[signals] Update error:", error);
    return NextResponse.json(
      { error: "Failed to update signal settings" },
      { status: 500 },
    );
  }
}
