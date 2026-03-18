import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";
import { formatGBP, formatInvoiceDate } from "./format";
import type { InvoiceWithLineItems } from "./types";

/**
 * Send a branded overdue reminder email to a client.
 *
 * Uses the same email template style as other project notifications.
 * Only called when reminderSentAt is null to prevent duplicate sends.
 */
export async function sendOverdueReminderEmail(
  invoice: InvoiceWithLineItems,
  recipientEmail: string
): Promise<void> {
  const portalBase = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://portal.outsignal.ai";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
  const viewUrl = invoice.viewToken
    ? `${baseUrl}/api/invoices/${invoice.id}/pdf?token=${invoice.viewToken}`
    : `${portalBase}/portal/billing`;

  const subject = `Reminder: Invoice ${invoice.invoiceNumber} is overdue`;

  const html = emailLayout({
    body: `
      <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">Payment Reminder</h1>
      <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#dc2626;line-height:1.3;">${invoice.invoiceNumber}</p>
      <p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">This is a friendly reminder that the invoice below is now past due. Please arrange payment at your earliest convenience.</p>
      <!-- Invoice details box -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F8F7F5;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6B6B6B;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;">Invoice</td>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#2F2F2F;font-weight:600;text-align:right;padding-bottom:4px;">${invoice.invoiceNumber}</td>
              </tr>
              <tr>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6B6B6B;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding-bottom:4px;padding-top:12px;">Due Date</td>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#dc2626;font-weight:700;text-align:right;padding-bottom:4px;padding-top:12px;">${formatInvoiceDate(invoice.dueDate)}</td>
              </tr>
              <tr>
                <td style="border-top:1px solid #E8E5E1;padding-top:12px;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6B6B6B;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Amount Due</td>
                <td style="border-top:1px solid #E8E5E1;padding-top:12px;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;color:#2F2F2F;font-weight:700;text-align:right;">${formatGBP(invoice.totalPence)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <div style="height:28px;"></div>
      ${emailButton("View Invoice", viewUrl)}
      <div style="height:32px;"></div>
      <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
      ${emailNotice("If you have already made payment, please disregard this email. Contact us if you have any questions.")}
    `,
    footerNote: "This is an automated billing reminder.",
  });

  await audited(
    { notificationType: "overdue_reminder", channel: "email", recipient: recipientEmail },
    () => sendNotificationEmail({
      to: [recipientEmail],
      subject,
      html,
    }),
  );
}

/**
 * Detect invoices with status="sent" that are past their dueDate,
 * mark them as "overdue", send a reminder email to the client (once),
 * and alert admin via the ops Slack channel.
 *
 * @returns Count of invoices processed (marked overdue).
 */
export async function markAndNotifyOverdueInvoices(): Promise<number> {
  const now = new Date();

  // Find all sent invoices past their due date
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: "sent",
      dueDate: { lt: now },
    },
    include: { lineItems: true },
  });

  if (overdueInvoices.length === 0) return 0;

  let processedCount = 0;

  for (const invoice of overdueInvoices) {
    try {
      // Mark invoice as overdue
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "overdue" },
      });

      const typedInvoice = invoice as InvoiceWithLineItems;

      // Send client reminder email (only once — check reminderSentAt)
      if (invoice.reminderSentAt === null) {
        // Fetch workspace to get billing email
        const workspace = await prisma.workspace.findUnique({
          where: { slug: invoice.workspaceSlug },
        });

        if (workspace?.billingClientEmail) {
          try {
            await sendOverdueReminderEmail(typedInvoice, workspace.billingClientEmail);
            // Mark reminder as sent
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: { reminderSentAt: now },
            });
          } catch (emailErr) {
            console.error(
              `[overdue] Failed to send reminder email for ${invoice.invoiceNumber}:`,
              emailErr
            );
          }
        }
      }

      // Alert admin via ops Slack
      await notify({
        type: "overdue_invoice_alert",
        severity: "error",
        title: `Invoice overdue: ${invoice.invoiceNumber}`,
        message: `${invoice.clientCompanyName} (${invoice.workspaceSlug}) — ${formatGBP(invoice.totalPence)} due ${formatInvoiceDate(invoice.dueDate)}`,
        workspaceSlug: invoice.workspaceSlug,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          totalPence: invoice.totalPence,
          dueDate: invoice.dueDate.toISOString(),
          clientCompanyName: invoice.clientCompanyName,
        },
      });

      processedCount++;
    } catch (err) {
      console.error(`[overdue] Failed to process invoice ${invoice.invoiceNumber}:`, err);
    }
  }

  return processedCount;
}
