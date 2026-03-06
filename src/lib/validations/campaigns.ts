import { z } from "zod";

// POST /api/campaigns
export const createCampaignSchema = z.object({
  name: z.string().min(1, "name is required"),
  workspaceSlug: z.string().min(1, "workspaceSlug is required"),
  description: z.string().optional(),
  channels: z.array(z.string()).optional(),
  targetListId: z.string().optional(),
});

// PATCH /api/campaigns/[id]
export const updateCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  channels: z.array(z.string()).optional(),
  targetListId: z.string().nullable().optional(),
});

// PATCH /api/campaigns/[id]/signal-status
export const signalStatusSchema = z.object({
  action: z.enum(["pause", "resume", "archive"]),
});
