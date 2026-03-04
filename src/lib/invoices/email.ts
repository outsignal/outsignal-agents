import { Resend } from "resend";
import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import { InvoicePdfDocument } from "./pdf";
import { InvoiceWithLineItems } from "./types";
import { formatGBP, formatInvoiceDate } from "./format";

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "https://admin.outsignal.ai";
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

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f4f5;margin:0;padding:0;">
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
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#18181b;padding-bottom:12px;line-height:1.3;">Invoice ${invoice.invoiceNumber}</td>
              </tr>
              ${
                periodText
                  ? `<tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;padding-bottom:16px;line-height:1.7;">Please find your invoice attached for the period ${periodText}.</td>
              </tr>`
                  : `<tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#3f3f46;padding-bottom:16px;line-height:1.7;">Please find your invoice attached.</td>
              </tr>`
              }
              <!-- Amount due row -->
              <tr>
                <td style="padding-bottom:8px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;border-radius:6px;padding:0;" width="100%">
                    <tr>
                      <td style="padding:12px 16px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                          <tr>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Amount Due</td>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#71717a;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;text-align:right;">Due Date</td>
                          </tr>
                          <tr>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#18181b;">${formatGBP(invoice.totalPence)}</td>
                            <td style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#18181b;text-align:right;">${formatInvoiceDate(invoice.dueDate)}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <!-- CTA button -->
              <tr>
                <td style="padding-top:16px;padding-bottom:24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:#F0FF7A;border-radius:8px;">
                        <a href="${pdfUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#18181b;text-decoration:none;">View Invoice</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#a1a1aa;line-height:1.5;">The invoice PDF is also attached to this email.</td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background-color:#fafafa;padding:20px 32px;border-top:1px solid #e4e4e7;border-radius:0 0 8px 8px;">
            <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#a1a1aa;margin:0;line-height:1.5;">Outsignal &mdash; Cold Outbound Infrastructure</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
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
    process.env.RESEND_FROM ?? "Outsignal <notifications@outsignal.ai>";

  // Cast needed: renderToBuffer expects ReactElement<DocumentProps> but our
  // wrapper component has InvoicePdfDocumentProps. The Document is rendered internally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(
    React.createElement(InvoicePdfDocument, { invoice }) as any,
  );

  await resend.emails.send({
    from,
    to: [recipientEmail],
    subject: `Invoice ${invoice.invoiceNumber} from Outsignal`,
    html: invoiceEmailHtml(invoice),
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
}
