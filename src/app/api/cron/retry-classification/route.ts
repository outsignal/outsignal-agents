import { NextResponse } from "next/server";
import { validateCronSecret } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { classifyReply } from "@/lib/classification/classify-reply";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!validateCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch up to 50 unclassified replies, oldest first
    const unclassified = await prisma.reply.findMany({
      where: { classifiedAt: null },
      take: 50,
      orderBy: { createdAt: "asc" },
    });

    let classified = 0;
    let failed = 0;

    for (const reply of unclassified) {
      try {
        const classification = await classifyReply({
          subject: reply.subject,
          bodyText: reply.bodyText,
          senderName: reply.senderName,
          outboundSubject: reply.outboundSubject,
          outboundBody: reply.outboundBody,
        });

        await prisma.reply.update({
          where: { id: reply.id },
          data: {
            intent: classification.intent,
            sentiment: classification.sentiment,
            objectionSubtype: classification.objectionSubtype,
            classificationSummary: classification.summary,
            classifiedAt: new Date(),
          },
        });

        classified++;
        console.log(
          `[retry-classification] Classified reply ${reply.id}: intent=${classification.intent}, sentiment=${classification.sentiment}`,
        );
      } catch (err) {
        failed++;
        console.error(
          `[retry-classification] Failed to classify reply ${reply.id}:`,
          err,
        );
      }
    }

    console.log(
      `[retry-classification] Done: ${classified} classified, ${failed} failed out of ${unclassified.length} total`,
    );

    return NextResponse.json({
      ok: true,
      total: unclassified.length,
      classified,
      failed,
    });
  } catch (err) {
    console.error("[retry-classification] Unhandled error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "Internal server error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
