import { z } from "zod";

// --- String literal union types ---

export type InsightCategory = "performance" | "copy" | "objections" | "icp";

export type ActionType =
  | "pause_campaign"
  | "update_icp_threshold"
  | "flag_copy_review"
  | "adjust_signal_targeting";

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
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  pause_campaign: "Pause Campaign",
  update_icp_threshold: "Update ICP Threshold",
  flag_copy_review: "Flag for Copy Review",
  adjust_signal_targeting: "Adjust Signal Targeting",
};

// --- Color maps for UI ---

export const CATEGORY_COLORS: Record<InsightCategory, string> = {
  performance: "border-l-blue-500",
  copy: "border-l-purple-500",
  objections: "border-l-orange-500",
  icp: "border-l-emerald-500",
};

export const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  high: "bg-green-100 text-green-800",
  medium: "bg-yellow-100 text-yellow-800",
  low: "bg-gray-100 text-gray-600",
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
