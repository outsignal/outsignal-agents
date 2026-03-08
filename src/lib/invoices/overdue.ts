import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { sendNotificationEmail } from "@/lib/resend";
import { audited } from "@/lib/notification-audit";
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

  const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
        <!-- Header -->
        <tr>
          <td style="background-color:#18181b;padding:20px 32px;border-radius:8px 8px 0 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:3px;color:#F0FF7A;">OUTSIGNAL</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="background-color:#ffffff;padding:32px 32px 24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:8px;line-height:1.3;">Invoice Overdue</td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;padding-bottom:24px;line-height:1.7;">
                  This is a reminder that invoice <strong>${invoice.invoiceNumber}</strong> is now overdue. Please arrange payment at your earliest convenience.
                </td>
              </tr>
              <!-- Invoice details -->
              <tr>
                <td style="background-color:#f4f4f5;border-radius:6px;padding:16px 20px;margin-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#71717a;padding-bottom:4px;">Invoice Number</td>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#18181b;font-weight:600;text-align:right;">${invoice.invoiceNumber}</td>
                    </tr>
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#71717a;padding-bottom:4px;">Due Date</td>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#dc2626;font-weight:600;text-align:right;">${formatInvoiceDate(invoice.dueDate)}</td>
                    </tr>
                    <tr>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#71717a;">Amount Due</td>
                      <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#18181b;font-weight:700;text-align:right;">${formatGBP(invoice.totalPence)}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr><td style="height:24px;"></td></tr>
              <!-- CTA button -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${viewUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Invoice</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;line-height:1.5;">
                  If you have already made payment, please disregard this email. Contact us if you have any questions.
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; This is an automated billing reminder.</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

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
        type: "system",
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
