import { beforeEach, describe, expect, it, vi } from "vitest";

const generateDueInvoicesMock = vi.fn();
const alertUnpaidBeforeRenewalMock = vi.fn();
const markAndNotifyOverdueInvoicesMock = vi.fn();
const ensureRecurringTasksCurrentMock = vi.fn();

vi.mock("@trigger.dev/sdk", () => ({
  schedules: {
    task: (config: unknown) => config,
  },
}));

vi.mock("@/lib/invoices/generator", () => ({
  generateDueInvoices: (...args: unknown[]) => generateDueInvoicesMock(...args),
  alertUnpaidBeforeRenewal: (...args: unknown[]) => alertUnpaidBeforeRenewalMock(...args),
}));

vi.mock("@/lib/invoices/overdue", () => ({
  markAndNotifyOverdueInvoices: (...args: unknown[]) => markAndNotifyOverdueInvoicesMock(...args),
}));

vi.mock("@/lib/clients/operations", () => ({
  ensureRecurringTasksCurrent: (...args: unknown[]) => ensureRecurringTasksCurrentMock(...args),
}));

describe("invoice-processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("continues subsequent billing steps when invoice generation fails", async () => {
    generateDueInvoicesMock.mockRejectedValue(new Error("db down"));
    markAndNotifyOverdueInvoicesMock.mockResolvedValue(3);
    alertUnpaidBeforeRenewalMock.mockResolvedValue(2);
    ensureRecurringTasksCurrentMock.mockResolvedValue(1);

    const { invoiceProcessorTask } = await import("../../trigger/invoice-processor");
    const result = await (invoiceProcessorTask as unknown as { run: () => Promise<unknown> }).run();

    expect(markAndNotifyOverdueInvoicesMock).toHaveBeenCalled();
    expect(alertUnpaidBeforeRenewalMock).toHaveBeenCalled();
    expect(ensureRecurringTasksCurrentMock).toHaveBeenCalled();
    expect(result).toEqual({
      invoicesGenerated: 0,
      invoicesSkipped: 0,
      overdueInvoices: 3,
      unpaidRenewalAlerts: 2,
      recurringTasksCreated: 1,
      errors: [expect.stringContaining("generateDueInvoices: db down")],
    });
  });

  it("throws when all billing steps fail so Trigger can retry", async () => {
    generateDueInvoicesMock.mockRejectedValue(new Error("gen down"));
    markAndNotifyOverdueInvoicesMock.mockRejectedValue(new Error("overdue down"));
    alertUnpaidBeforeRenewalMock.mockRejectedValue(new Error("alerts down"));
    ensureRecurringTasksCurrentMock.mockRejectedValue(new Error("tasks down"));

    const { invoiceProcessorTask } = await import("../../trigger/invoice-processor");

    await expect(
      (invoiceProcessorTask as unknown as { run: () => Promise<unknown> }).run(),
    ).rejects.toThrow(/all billing steps failed/i);
  });
});
