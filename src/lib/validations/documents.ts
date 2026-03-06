import { z } from "zod";

// POST /api/documents/upload (JSON mode only)
export const documentUploadJsonSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string().min(1, "text is required"),
    url: z.never().optional(),
  }),
  z.object({
    url: z.string().url("Invalid Google Doc URL"),
    type: z.never().optional(),
    text: z.never().optional(),
  }),
]);
