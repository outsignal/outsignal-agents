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
    const billingStepNames = [
      "generateDueInvoices",
      "markAndNotifyOverdueInvoices",
      "alertUnpaidBeforeRenewal",
      "ensureRecurringTasksCurrent",
    ] as const;
    console.log(`[${timestamp}] [invoice-processor] Starting invoice processing`);

    const errors: string[] = [];
    let invoiceGenResult = { created: 0, skipped: 0 };
    let overdueCount = 0;
    let unpaidAlertCount = 0;
    let recurringCreated = 0;

    try {
      invoiceGenResult = await generateDueInvoices();
      console.log(
        `[${timestamp}] [invoice-processor] Invoice generation: ${invoiceGenResult.created} created, ${invoiceGenResult.skipped} skipped`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`generateDueInvoices: ${message}`);
      console.error(`[${timestamp}] [invoice-processor] Invoice generation failed:`, err);
    }

    try {
      overdueCount = await markAndNotifyOverdueInvoices();
      if (overdueCount > 0) {
        console.log(`[${timestamp}] [invoice-processor] Overdue invoices: ${overdueCount} marked overdue`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`markAndNotifyOverdueInvoices: ${message}`);
      console.error(`[${timestamp}] [invoice-processor] Overdue processing failed:`, err);
    }

    try {
      unpaidAlertCount = await alertUnpaidBeforeRenewal();
      if (unpaidAlertCount > 0) {
        console.log(`[${timestamp}] [invoice-processor] Unpaid renewal alerts: ${unpaidAlertCount} sent`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`alertUnpaidBeforeRenewal: ${message}`);
      console.error(`[${timestamp}] [invoice-processor] Renewal alert processing failed:`, err);
    }

    try {
      // Catch-up: ensure all recurring tasks have a pending sibling
      recurringCreated = await ensureRecurringTasksCurrent();
      if (recurringCreated > 0) {
        console.log(`[${timestamp}] [invoice-processor] Recurring tasks: ${recurringCreated} new occurrences created`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`ensureRecurringTasksCurrent: ${message}`);
      console.error(`[${timestamp}] [invoice-processor] Recurring task catch-up failed:`, err);
    }

    if (errors.length > 0) {
      console.error(`[${timestamp}] [invoice-processor] Complete with ${errors.length} error(s): ${errors.join(" | ")}`);
      if (errors.length === billingStepNames.length) {
        throw new Error(
          `[invoice-processor] All billing steps failed: ${errors.join(" | ")}`,
        );
      }
    } else {
      console.log(`[${timestamp}] [invoice-processor] Complete`);
    }

    return {
      invoicesGenerated: invoiceGenResult.created,
      invoicesSkipped: invoiceGenResult.skipped,
      overdueInvoices: overdueCount,
      unpaidRenewalAlerts: unpaidAlertCount,
      recurringTasksCreated: recurringCreated,
      errors,
    };
  },
});
