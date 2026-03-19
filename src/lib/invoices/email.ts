import { Resend } from "resend";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { InvoicePdfDocument } from "./pdf";
import { InvoiceWithLineItems } from "./types";
import { formatGBP, formatInvoiceDate } from "./format";
import { audited } from "@/lib/notification-audit";
import { emailLayout, emailButton, emailNotice } from "@/lib/email-template";

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://admin.outsignal.ai";
}

/**
 * Build the HTML email body for an invoice notification.
 * Follows the project's existing email template pattern (OUTSIGNAL header bar + body + CTA + footer).
 */
export function invoiceEmailHtml(invoice: InvoiceWithLineItems): string {
  const periodText =
    invoice.billingPeriodStart && invoice.billingPeriodEnd
      ? `${formatInvoiceDate(invoice.billingPeriodStart)} - ${formatInvoiceDate(invoice.billingPeriodEnd)}`
      : null;

  const pdfUrl = `${getBaseUrl()}/api/invoices/${invoice.id}/pdf?token=${invoice.viewToken}`;

  return emailLayout({
    body: `
      ${
        periodText
          ? `<p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">Please find your invoice for the period <strong style="color:#2F2F2F;">${periodText}</strong>.</p>`
          : `<p style="margin:0 0 28px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;color:#6B6B6B;line-height:1.7;">Please find your invoice below.</p>`
      }
      <h1 style="margin:0 0 6px 0;font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;color:#2F2F2F;line-height:1.3;">Invoice ${invoice.invoiceNumber}</h1>
      <div style="height:24px;"></div>
      <!-- Amount due box -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F8F7F5;border-radius:8px;">
        <tr>
          <td style="padding:20px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6B6B6B;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding-bottom:6px;">Amount Due</td>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#6B6B6B;font-weight:600;text-transform:uppercase;letter-spacing:1px;text-align:right;padding-bottom:6px;">Due Date</td>
              </tr>
              <tr>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#2F2F2F;">${formatGBP(invoice.totalPence)}</td>
                <td style="font-family:'Geist Sans',system-ui,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;color:#2F2F2F;text-align:right;">${formatInvoiceDate(invoice.dueDate)}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <div style="height:28px;"></div>
      ${emailButton("View Invoice", pdfUrl)}
      <div style="height:32px;"></div>
      <div style="border-top:1px solid #E8E5E1;margin-bottom:28px;"></div>
      ${emailNotice("The invoice PDF is also attached to this email for your records.")}
    `,
    footerNote: "Thank you for your business.",
  });
}

/**
 * Send an invoice email via Resend with the PDF attached.
 *
 * Generates the PDF buffer via @react-pdf/renderer and sends via Resend.
 */
export async function sendInvoiceEmail(
  invoice: InvoiceWithLineItems,
  recipientEmail: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[sendInvoiceEmail] RESEND_API_KEY not set, skipping email");
    return;
  }

  const resend = new Resend(apiKey);
  const from =
    process.env.RESEND_FROM ?? "Outsignal <notifications@notification.outsignal.ai>";

  // Cast needed: renderToBuffer expects ReactElement<DocumentProps> but our
  // wrapper component has InvoicePdfDocumentProps. The Document is rendered internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(
    React.createElement(InvoicePdfDocument, { invoice }) as any,
  );

  await audited(
    { notificationType: "invoice", channel: "email", recipient: recipientEmail },
    async () => { await resend.emails.send({
      from,
      to: [recipientEmail],
      bcc: ["jonathan@outsignal.ai"],
      subject: `Invoice ${invoice.invoiceNumber} from Outsignal`,
      html: invoiceEmailHtml(invoice),
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer,
        },
      ],
    }); },
  );
}
