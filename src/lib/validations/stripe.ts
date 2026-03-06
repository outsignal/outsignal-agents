import { z } from "zod";

// POST /api/stripe/checkout
export const stripeCheckoutSchema = z.object({
  proposalId: z.string().min(1, "proposalId is required"),
});
