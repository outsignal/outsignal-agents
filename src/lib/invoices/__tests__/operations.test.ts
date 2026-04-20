import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueInvoiceMock = vi.fn();
const updateInvoiceMock = vi.fn();
const findUniqueWorkspaceMock = vi.fn();
const updateManyWorkspaceMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findUnique: (...args: unknown[]) => findUniqueInvoiceMock(...args),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        invoice: {
          update: (...args: unknown[]) => updateInvoiceMock(...args),
        },
        workspace: {
          findUnique: (...args: unknown[]) => findUniqueWorkspaceMock(...args),
          updateMany: (...args: unknown[]) => updateManyWorkspaceMock(...args),
        },
      }),
    ),
  },
}));

vi.mock("@/lib/invoices/numbering", () => ({
  getNextInvoiceNumber: vi.fn(),
}));

describe("updateInvoiceStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses an optimistic renewalDate guard when advancing billing on payment", async () => {
    const renewalDate = new Date("2026-04-30T00:00:00.000Z");
    findUniqueInvoiceMock.mockResolvedValue({
      id: "inv-1",
      workspaceSlug: "acme",
      status: "sent",
      renewalDate,
      lineItems: [],
    });
    updateInvoiceMock.mockResolvedValue({
      id: "inv-1",
      workspaceSlug: "acme",
      status: "paid",
      lineItems: [],
    });
    findUniqueWorkspaceMock.mockResolvedValue({
      slug: "acme",
      billingRenewalDate: renewalDate,
    });
    updateManyWorkspaceMock.mockResolvedValue({ count: 1 });

    const { updateInvoiceStatus } = await import("@/lib/invoices/operations");
    await updateInvoiceStatus("inv-1", "paid");

    expect(updateManyWorkspaceMock).toHaveBeenCalledWith({
      where: {
        slug: "acme",
        billingRenewalDate: renewalDate,
      },
      data: {
        billingRenewalDate: new Date("2026-05-30T00:00:00.000Z"),
      },
    });
  });

  it("throws when the renewalDate optimistic lock loses the race", async () => {
    const renewalDate = new Date("2026-04-30T00:00:00.000Z");
    findUniqueInvoiceMock.mockResolvedValue({
      id: "inv-1",
      workspaceSlug: "acme",
      status: "sent",
      renewalDate,
      lineItems: [],
    });
    updateInvoiceMock.mockResolvedValue({
      id: "inv-1",
      workspaceSlug: "acme",
      status: "paid",
      lineItems: [],
    });
    findUniqueWorkspaceMock.mockResolvedValue({
      slug: "acme",
      billingRenewalDate: renewalDate,
    });
    updateManyWorkspaceMock.mockResolvedValue({ count: 0 });

    const { updateInvoiceStatus } = await import("@/lib/invoices/operations");

    await expect(updateInvoiceStatus("inv-1", "paid")).rejects.toThrow(
      /billing renewal date changed concurrently/i,
    );
  });
});
