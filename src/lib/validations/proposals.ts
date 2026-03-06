import { z } from "zod";

// POST /api/proposals
export const createProposalSchema = z.object({
  clientName: z.string().min(1, "clientName is required"),
  clientEmail: z.string().email().optional(),
  companyOverview: z.string().min(1, "companyOverview is required"),
  packageType: z.string().min(1, "packageType is required"),
  setupFee: z.number().optional(),
  platformCost: z.number().optional(),
  retainerCost: z.number().optional(),
});

// PATCH /api/proposals/[id]
export const updateProposalSchema = z.object({
  clientName: z.string().min(1).optional(),
  clientEmail: z.string().email().nullable().optional(),
  companyOverview: z.string().optional(),
  packageType: z.string().optional(),
  setupFee: z.number().optional(),
  platformCost: z.number().optional(),
  retainerCost: z.number().optional(),
  paidManually: z.boolean().optional(),
  status: z.string().optional(),
});

// POST /api/proposals/[id]/accept
export const acceptProposalSchema = z.object({
  signatureName: z.string().min(1, "Signature name is required"),
  signatureData: z.string().min(1, "Signature data is required"),
});
