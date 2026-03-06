import { z } from "zod";

const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPricePence: z.number(),
});

// POST /api/invoices
export const createInvoiceSchema = z.object({
  workspaceSlug: z.string().min(1, "workspaceSlug is required"),
  lineItems: z.array(lineItemSchema).min(1, "lineItems must be a non-empty array"),
  billingPeriodStart: z.string().optional(),
  billingPeriodEnd: z.string().optional(),
  issueDate: z.string().optional(),
});

// PATCH /api/invoices/[id]
export const updateInvoiceStatusSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "overdue"]),
});

// PUT /api/invoice-settings
export const invoiceSettingsSchema = z.object({
  senderName: z.string().min(1, "senderName is required"),
  senderAddress: z.string().nullable().optional(),
  senderEmail: z.string().email("senderEmail must be a valid email"),
  accountNumber: z.string().nullable().optional(),
  sortCode: z.string().nullable().optional(),
});
