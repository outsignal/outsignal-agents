import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { prisma } from "@/lib/db";
import { searchKnowledge } from "@/lib/knowledge/store";
import { notifyAdminOfEscalation } from "@/lib/push";

interface AutoResponseResult {
  message: string;
  escalated: boolean;
  confidence: number | null;
}

export async function generateAutoResponse(
  conversationId: string,
  clientMessage: string,
): Promise<AutoResponseResult> {
  // Get workspace slug for escalation notifications
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    select: { workspaceSlug: true },
  });

  // 1. Search knowledge base
  const kbResults = await searchKnowledge(clientMessage, { limit: 5 });

  // 2. Search FAQ articles with simple keyword matching
  const keywords = clientMessage
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .map((w) => w.toLowerCase());

  const faqResults =
    keywords.length > 0
      ? await prisma.faqArticle.findMany({
          where: {
            published: true,
            OR: keywords.flatMap((kw) => [
              { question: { contains: kw, mode: "insensitive" as const } },
              { answer: { contains: kw, mode: "insensitive" as const } },
            ]),
          },
          take: 5,
        })
      : [];

  // 3. Check if we should auto-escalate (3+ consecutive client messages with no admin reply)
  const recentMessages = await prisma.supportMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { role: true },
  });

  let consecutiveClientMessages = 0;
  for (const msg of recentMessages) {
    if (msg.role === "client") {
      consecutiveClientMessages++;
    } else if (msg.role === "admin") {
      break;
    }
    // AI messages don't reset the counter — only admin replies do
  }

  const shouldAutoEscalate = consecutiveClientMessages >= 3;

  // 4. Generate AI response (unless auto-escalating)
  let aiText: string | null = null;

  if (!shouldAutoEscalate) {
    try {
      const { text } = await generateText({
        model: anthropic("claude-sonnet-4-20250514"),
        system: `You are Outsignal's support assistant. Answer the client's question using ONLY the provided context from our knowledge base and FAQ articles. Be concise, friendly, and professional.

If you cannot answer confidently from the provided context, respond with exactly: [ESCALATE]
If the client is asking to speak with a human or seems frustrated, respond with exactly: [ESCALATE]
Do not make up information. Do not reference that you are searching a knowledge base.`,
        prompt: `Client message: ${clientMessage}

Knowledge base context:
${kbResults.map((r) => `[${r.title}] ${r.chunk}`).join("\n\n")}

FAQ articles:
${faqResults.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n")}`,
      });

      aiText = text;
    } catch {
      // AI call failed — treat as unable to answer, escalate
      aiText = null;
    }
  }

  // 5. Determine if we should escalate
  const shouldEscalate =
    shouldAutoEscalate || !aiText || aiText.includes("[ESCALATE]");

  // 6. Escalate path
  if (shouldEscalate) {
    const escalationMessage =
      "I'll connect you with the team — they typically respond within 30 minutes.";

    await prisma.supportMessage.create({
      data: {
        conversationId,
        role: "ai",
        content: escalationMessage,
        escalated: true,
      },
    });

    await prisma.supportConversation.update({
      where: { id: conversationId },
      data: {
        unreadByAdmin: true,
        lastMessageAt: new Date(),
      },
    });

    // Notify admins via push, email, and Slack
    try {
      await notifyAdminOfEscalation(conversation?.workspaceSlug ?? "unknown", clientMessage);
    } catch (err) {
      console.error("[auto-respond] Failed to notify admins:", err instanceof Error ? err.message : err);
    }

    return { message: escalationMessage, escalated: true, confidence: null };
  }

  // 7. Normal AI response path
  await prisma.supportMessage.create({
    data: {
      conversationId,
      role: "ai",
      content: aiText!,
      confidence: 0.8,
    },
  });

  await prisma.supportConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  });

  return { message: aiText!, escalated: false, confidence: 0.8 };
}
