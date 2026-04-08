import { schedules } from "@trigger.dev/sdk";
import { PrismaClient } from "@prisma/client";
import { classifyReply } from "@/lib/classification/classify-reply";
import { anthropicQueue } from "./queues";

// PrismaClient at module scope — not inside run()
const prisma = new PrismaClient();

export const retryClassification = schedules.task({
  id: "retry-classification",
  cron: "*/30 * * * *", // every 30 minutes
  queue: anthropicQueue,
  maxDuration: 300, // 5 min — enough for all unclassified replies
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
  },

  run: async () => {
    // Fetch unclassified replies: cap at 50 per run, skip replies that have hit the attempt limit
    const unclassified = await prisma.reply.findMany({
      where: {
        classifiedAt: null,
        classificationAttempts: { lt: 5 },
      },
      orderBy: { createdAt: "asc" },
      take: 50,
    });

    console.log(
      `[retry-classification] Found ${unclassified.length} unclassified replies (attempt limit <5)`,
    );

    let classified = 0;
    let failed = 0;

    for (const reply of unclassified) {
      // Increment attempt counter before trying — counts this attempt regardless of outcome
      await prisma.reply.update({
        where: { id: reply.id },
        data: { classificationAttempts: { increment: 1 } },
      });

      // Warn when a reply has now reached 5 attempts (will be excluded next run)
      if (reply.classificationAttempts + 1 >= 5) {
        console.warn(
          `[retry-classification] Reply ${reply.id} (${reply.senderEmail}) has reached 5 classification attempts — will not be retried further`,
        );
      }

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

    return { total: unclassified.length, classified, failed };
  },
});
