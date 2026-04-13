import { schedules } from "@trigger.dev/sdk";
import { generateDueInvoices, alertUnpaidBeforeRenewal } from "@/lib/invoices/generator";
import { markAndNotifyOverdueInvoices } from "@/lib/invoices/overdue";
import { ensureRecurringTasksCurrent } from "@/lib/clients/operations";

export const invoiceProcessorTask = schedules.task({
  id: "invoice-processor",
  cron: "0 7 * * *", // daily at 7am UTC — after inbox checks
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 60_000,
  },

  run: async () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [invoice-processor] Starting invoice processing`);

    const invoiceGenResult = await generateDueInvoices();
    console.log(
      `[${timestamp}] [invoice-processor] Invoice generation: ${invoiceGenResult.created} created, ${invoiceGenResult.skipped} skipped`,
    );

    const overdueCount = await markAndNotifyOverdueInvoices();
    if (overdueCount > 0) {
      console.log(`[${timestamp}] [invoice-processor] Overdue invoices: ${overdueCount} marked overdue`);
    }

    const unpaidAlertCount = await alertUnpaidBeforeRenewal();
    if (unpaidAlertCount > 0) {
      console.log(`[${timestamp}] [invoice-processor] Unpaid renewal alerts: ${unpaidAlertCount} sent`);
    }

    // Catch-up: ensure all recurring tasks have a pending sibling
    const recurringCreated = await ensureRecurringTasksCurrent();
    if (recurringCreated > 0) {
      console.log(`[${timestamp}] [invoice-processor] Recurring tasks: ${recurringCreated} new occurrences created`);
    }

    console.log(`[${timestamp}] [invoice-processor] Complete`);

    return {
      invoicesGenerated: invoiceGenResult.created,
      invoicesSkipped: invoiceGenResult.skipped,
      overdueInvoices: overdueCount,
      unpaidRenewalAlerts: unpaidAlertCount,
      recurringTasksCreated: recurringCreated,
    };
  },
});
