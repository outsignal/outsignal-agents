import { z } from "zod";

// POST /api/senders
export const createSenderSchema = z.object({
  workspaceSlug: z.string().min(1, "workspaceSlug is required"),
  name: z.string().trim().min(1, "name is required"),
  emailAddress: z.string().optional(),
  linkedinProfileUrl: z.string().optional(),
  linkedinEmail: z.string().optional(),
  proxyUrl: z.string().optional(),
  linkedinTier: z.string().optional(),
  dailyConnectionLimit: z.number().optional(),
  dailyMessageLimit: z.number().optional(),
  dailyProfileViewLimit: z.number().optional(),
});

// PATCH /api/senders/[id]
export const updateSenderSchema = z.object({
  name: z.string().trim().min(1).optional(),
  emailAddress: z.string().nullable().optional(),
  linkedinProfileUrl: z.string().nullable().optional(),
  linkedinEmail: z.string().nullable().optional(),
  proxyUrl: z.string().nullable().optional(),
  linkedinTier: z.string().nullable().optional(),
  dailyConnectionLimit: z.number().optional(),
  dailyMessageLimit: z.number().optional(),
  dailyProfileViewLimit: z.number().optional(),
  status: z.enum(["setup", "active", "paused", "disabled"]).optional(),
});
