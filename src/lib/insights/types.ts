import { z } from "zod";

// --- String literal union types ---

export type InsightCategory = "performance" | "copy" | "objections" | "icp" | "deliverability";

export type ActionType =
  | "pause_campaign"
  | "update_icp_threshold"
  | "flag_copy_review"
  | "adjust_signal_targeting"
  | "pause_sender";

export type InsightStatus =
  | "active"
  | "approved"
  | "dismissed"
  | "snoozed"
  | "executed"
  | "failed";

export type ConfidenceLevel = "high" | "medium" | "low";

// --- Display label maps ---

export const CATEGORY_LABELS: Record<InsightCategory, string> = {
  performance: "Performance",
  copy: "Copy",
  objections: "Objections",
  icp: "ICP",
  deliverability: "Deliverability",
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  pause_campaign: "Pause Campaign",
  update_icp_threshold: "Update ICP Threshold",
  flag_copy_review: "Flag for Copy Review",
  adjust_signal_targeting: "Adjust Signal Targeting",
  pause_sender: "Pause Sender",
};

// --- Color maps for UI ---

export const CATEGORY_COLORS: Record<InsightCategory, string> = {
  performance: "border-l-blue-500",
  copy: "border-l-purple-500",
  objections: "border-l-orange-500",
  icp: "border-l-emerald-500",
  deliverability: "border-l-red-500",
};

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  low: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
};

// --- Zod schema for generateObject output ---

export const InsightSchema = z.object({
  insights: z
    .array(
      z.object({
        category: z.enum(["performance", "copy", "objections", "icp"]),
        observation: z
          .string()
          .describe(
            "Data-first finding, e.g. 'Reply rate dropped 40% this week across 3 campaigns'",
          ),
        evidence: z.array(
          z.object({
            metric: z.string(),
            value: z.string(),
            change: z.string().nullable(),
          }),
        ),
        suggestedAction: z.object({
          type: z.enum([
            "pause_campaign",
            "update_icp_threshold",
            "flag_copy_review",
            "adjust_signal_targeting",
          ]),
          description: z.string(),
          params: z.record(z.string(), z.string()).nullable(),
        }),
        confidence: z.enum(["high", "medium", "low"]),
        priority: z
          .number()
          .min(1)
          .max(10)
          .describe("1 = highest priority, 10 = lowest"),
      }),
    )
    .min(1)
    .max(5),
});

export type InsightGeneration = z.infer<typeof InsightSchema>;
