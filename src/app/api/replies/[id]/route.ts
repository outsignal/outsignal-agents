import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  INTENTS,
  SENTIMENTS,
  OBJECTION_SUBTYPES,
} from "@/lib/classification/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const { overrideIntent, overrideSentiment, overrideObjSubtype } = body;

    // Validate overrideIntent
    if (
      overrideIntent !== undefined &&
      overrideIntent !== null &&
      !(INTENTS as readonly string[]).includes(overrideIntent)
    ) {
      return NextResponse.json(
        {
          error: `Invalid overrideIntent: "${overrideIntent}". Must be one of: ${INTENTS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate overrideSentiment
    if (
      overrideSentiment !== undefined &&
      overrideSentiment !== null &&
      !(SENTIMENTS as readonly string[]).includes(overrideSentiment)
    ) {
      return NextResponse.json(
        {
          error: `Invalid overrideSentiment: "${overrideSentiment}". Must be one of: ${SENTIMENTS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Validate overrideObjSubtype
    if (
      overrideObjSubtype !== undefined &&
      overrideObjSubtype !== null
    ) {
      if (!(OBJECTION_SUBTYPES as readonly string[]).includes(overrideObjSubtype)) {
        return NextResponse.json(
          {
            error: `Invalid overrideObjSubtype: "${overrideObjSubtype}". Must be one of: ${OBJECTION_SUBTYPES.join(", ")}`,
          },
          { status: 400 },
        );
      }

      // Only allow objection subtype when effective intent would be "objection"
      const effectiveIntent = overrideIntent ?? undefined;
      // Need to check the existing record's intent if no override provided
      if (effectiveIntent !== undefined && effectiveIntent !== "objection") {
        return NextResponse.json(
          {
            error:
              'overrideObjSubtype can only be set when effective intent is "objection"',
          },
          { status: 400 },
        );
      }
    }

    // Check reply exists
    const existing = await prisma.reply.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    // Additional check: if overrideObjSubtype is provided but no overrideIntent,
    // the existing intent (or overrideIntent) must be "objection"
    if (
      overrideObjSubtype !== undefined &&
      overrideObjSubtype !== null &&
      overrideIntent === undefined
    ) {
      const currentEffectiveIntent =
        existing.overrideIntent ?? existing.intent;
      if (currentEffectiveIntent !== "objection") {
        return NextResponse.json(
          {
            error:
              'overrideObjSubtype can only be set when effective intent is "objection"',
          },
          { status: 400 },
        );
      }
    }

    // Build update data — only include fields that were provided
    const updateData: Record<string, unknown> = {
      overriddenAt: new Date(),
      overriddenBy: "admin",
    };

    if (overrideIntent !== undefined) {
      updateData.overrideIntent = overrideIntent;
    }
    if (overrideSentiment !== undefined) {
      updateData.overrideSentiment = overrideSentiment;
    }
    if (overrideObjSubtype !== undefined) {
      updateData.overrideObjSubtype = overrideObjSubtype;
    }

    const updated = await prisma.reply.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      reply: {
        ...updated,
        effectiveIntent: updated.overrideIntent ?? updated.intent,
        effectiveSentiment: updated.overrideSentiment ?? updated.sentiment,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/replies/:id] Error:", error);
    return NextResponse.json(
      { error: "Failed to update reply" },
      { status: 500 },
    );
  }
}
