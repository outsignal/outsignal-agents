import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";

const OooExtractionSchema = z.object({
  oooReason: z
    .enum(["holiday", "illness", "conference", "generic"])
    .describe(
      "Category of the out-of-office absence: holiday (vacation/annual leave), illness (sick leave/medical), conference (event/training/business travel), generic (no specific reason given)",
    ),
  oooUntil: z
    .string()
    .describe(
      "Return date in ISO YYYY-MM-DD format. If no date is mentioned, return the default date provided. Must be a valid calendar date.",
    ),
  confidence: z
    .enum(["extracted", "defaulted"])
    .describe(
      "extracted = date was explicitly stated or reliably inferred from the message, defaulted = no date found so the 14-day default was used",
    ),
  eventName: z
    .string()
    .nullable()
    .describe(
      "Name of event, conference, or holiday if mentioned (e.g. 'Dreamforce', 'Christmas', 'Easter'). Null if no specific event named.",
    ),
});

export type OooExtractionResult = {
  oooUntil: Date;
  oooReason: "holiday" | "illness" | "conference" | "generic";
  confidence: "extracted" | "defaulted";
  eventName: string | null;
};

export async function extractOooDetails(params: {
  bodyText: string;
  receivedAt: Date;
}): Promise<OooExtractionResult> {
  const { bodyText, receivedAt } = params;

  // Calculate default date (14 days from receivedAt)
  const defaultDate = new Date(receivedAt);
  defaultDate.setDate(defaultDate.getDate() + 14);
  const defaultDateStr = defaultDate.toISOString().split("T")[0];

  // Today's date for relative date resolution
  const todayStr = receivedAt.toISOString().split("T")[0];

  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: OooExtractionSchema,
    prompt: `Extract out-of-office details from this auto-reply message.

TODAY'S DATE (when reply was received): ${todayStr}
DEFAULT RETURN DATE (use if no date found): ${defaultDateStr}

OUT-OF-OFFICE MESSAGE:
${bodyText}

INSTRUCTIONS:
1. Determine the oooReason category: holiday (vacation/annual leave), illness (sick/medical), conference (event/training/business trip), generic (no clear reason)
2. Find the return date. Resolve relative dates using today's date (e.g. "back next Monday", "returning after Easter")
3. If a specific date is mentioned or can be reliably inferred → use it, set confidence="extracted"
4. If NO date is mentioned or cannot be determined → use the default date (${defaultDateStr}), set confidence="defaulted"
5. Return oooUntil as YYYY-MM-DD format only
6. Extract event/conference/holiday name if explicitly mentioned`,
  });

  return {
    oooUntil: new Date(object.oooUntil + "T00:00:00.000Z"),
    oooReason: object.oooReason,
    confidence: object.confidence,
    eventName: object.eventName,
  };
}
