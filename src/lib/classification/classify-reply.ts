import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { INTENTS, SENTIMENTS, OBJECTION_SUBTYPES } from "./types";
import type { ClassificationResult } from "./types";

export const ClassificationSchema = z.object({
  intent: z.enum(INTENTS),
  sentiment: z.enum(SENTIMENTS),
  objectionSubtype: z
    .enum(OBJECTION_SUBTYPES)
    .nullable()
    .describe("Only set when intent is 'objection', null otherwise"),
  summary: z
    .string()
    .describe("One sentence explaining the classification reasoning, max 200 characters"),
});

const MAX_SUMMARY_LENGTH = 200;

export function normalizeClassificationResult(
  result: ClassificationResult,
): ClassificationResult {
  const summary = result.summary.trim();
  if (summary.length > MAX_SUMMARY_LENGTH) {
    console.warn(
      `[reply-classification] Anthropic returned ${summary.length}-character summary; truncating to ${MAX_SUMMARY_LENGTH}.`,
    );
    return {
      ...result,
      summary: summary.slice(0, MAX_SUMMARY_LENGTH),
    };
  }

  return { ...result, summary };
}

export async function classifyReply(params: {
  subject: string | null;
  bodyText: string;
  senderName: string | null;
  outboundSubject: string | null;
  outboundBody: string | null;
}): Promise<ClassificationResult> {
  const outboundContext =
    params.outboundSubject
      ? `\nORIGINAL OUTBOUND EMAIL:\nSubject: ${params.outboundSubject}\nBody: ${params.outboundBody ?? "(unavailable)"}`
      : "";

  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: ClassificationSchema,
    prompt: `Classify this email reply from a cold outreach campaign.

REPLY:
From: ${params.senderName ?? "Unknown"}
Subject: ${params.subject ?? "(no subject)"}
Body: ${params.bodyText}
${outboundContext}

INTENT DEFINITIONS:
- interested: Prospect expresses interest in learning more, wants a call, asks questions about the offering
- meeting_booked: Prospect explicitly confirms or proposes a specific meeting time
- objection: Prospect raises a specific concern (budget, timing, competitor, authority, need, trust)
- referral: Prospect redirects to another person or department
- not_now: Prospect explicitly says timing is wrong but does not rule out the future
- unsubscribe: Prospect asks to be removed from the list or stop receiving emails
- out_of_office: Auto-generated OOO reply with return date
- auto_reply: Any automated response (delivery receipt, ticket confirmation, DSN bounce)
- not_relevant: Reply that does not fit any other category (spam, confused, wrong person)

RULES:
1. For multi-intent replies, choose the PRIMARY intent (the most actionable one for a sales team).
2. For very short replies (under 10 words), classify based on the likely meaning in a sales outreach context.
3. For non-English text, classify based on your best understanding of the content.
4. Set objectionSubtype ONLY when intent is "objection". Otherwise it MUST be null.
5. Sentiment should reflect the prospect's attitude: positive (warm, open), neutral (factual, no emotion), negative (hostile, annoyed, dismissive).`,
  });

  return normalizeClassificationResult(object);
}
