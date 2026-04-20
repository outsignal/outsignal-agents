import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
}));

const requireAdminAuthMock = vi.fn();
const createInvoiceMock = vi.fn();
const getInvoiceMock = vi.fn();
const updateInvoiceStatusMock = vi.fn();
const sendInvoiceEmailMock = vi.fn();
const auditLogMock = vi.fn();

vi.mock("@/lib/require-admin-auth", () => ({
  requireAdminAuth: (...args: unknown[]) => requireAdminAuthMock(...args),
}));

vi.mock("@/lib/invoices/operations", () => ({
  createInvoice: (...args: unknown[]) => createInvoiceMock(...args),
  getInvoice: (...args: unknown[]) => getInvoiceMock(...args),
  updateInvoiceStatus: (...args: unknown[]) => updateInvoiceStatusMock(...args),
}));

vi.mock("@/lib/invoices/email", () => ({
  sendInvoiceEmail: (...args: unknown[]) => sendInvoiceEmailMock(...args),
}));

vi.mock("@/lib/audit", () => ({
  auditLog: (...args: unknown[]) => auditLogMock(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Invoice routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminAuthMock.mockResolvedValue({ email: "admin@example.com", role: "admin" });
  });

  it("passes renewalDate through the create invoice POST route", async () => {
    createInvoiceMock.mockResolvedValue({ id: "inv-1" });
    const { POST } = await import("@/app/api/invoices/route");

    const res = await POST(
      postRequest({
        workspaceSlug: "acme",
        lineItems: [{ description: "Retainer", quantity: 1, unitPricePence: 1000 }],
        renewalDate: "2026-04-30T00:00:00.000Z",
      }),
    );

    expect(res.status).toBe(201);
    expect(createInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceSlug: "acme",
        renewalDate: new Date("2026-04-30T00:00:00.000Z"),
      }),
    );
  });

  it("does not mark an invoice sent when invoice delivery is not configured", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      billingClientEmail: "client@example.com",
      billingCcEmails: null,
    } as never);
    getInvoiceMock.mockResolvedValue({
      id: "inv-1",
      invoiceNumber: "INV-1",
      workspaceSlug: "acme",
    });
    sendInvoiceEmailMock.mockResolvedValue({
      delivered: false,
      providerId: null,
      reason: "resend_not_configured",
    });

    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    const res = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "inv-1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "Invoice email delivery is not configured" });
    expect(updateInvoiceStatusMock).not.toHaveBeenCalled();
  });

  it("marks an invoice sent after successful delivery", async () => {
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
      billingClientEmail: "client@example.com",
      billingCcEmails: "ops@example.com, finance@example.com",
    } as never);
    getInvoiceMock.mockResolvedValue({
      id: "inv-1",
      invoiceNumber: "INV-1",
      workspaceSlug: "acme",
    });
    sendInvoiceEmailMock.mockResolvedValue({
      delivered: true,
      providerId: "email-123",
    });
    updateInvoiceStatusMock.mockResolvedValue({ id: "inv-1", status: "sent" });

    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    const res = await POST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ id: "inv-1" }),
    });

    expect(res.status).toBe(200);
    expect(sendInvoiceEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1" }),
      "client@example.com",
      ["ops@example.com", "finance@example.com"],
    );
    expect(updateInvoiceStatusMock).toHaveBeenCalledWith("inv-1", "sent");
  });
});
