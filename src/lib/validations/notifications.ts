import { z } from "zod";

// PATCH /api/notifications
export const markNotificationsSchema = z.union([
  z.object({
    markAllRead: z.literal(true),
    ids: z.never().optional(),
  }),
  z.object({
    markAllRead: z.never().optional(),
    ids: z.array(z.string()).min(1),
  }),
]);
