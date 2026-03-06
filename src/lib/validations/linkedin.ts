import { z } from "zod";

// POST /api/linkedin/senders/[id]/login
export const linkedinLoginSchema = z.object({
  email: z.string().min(1, "email is required"),
  password: z.string().min(1, "password is required"),
  totpSecret: z.string().optional(),
  verificationCode: z.string().optional(),
  method: z.string().optional(),
});
