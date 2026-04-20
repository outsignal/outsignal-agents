/**
 * Send invoice PS04 to lime-recruitment billing contact.
 * Usage: npx tsx scripts/send-ps04.ts
 */
import { getInvoice, updateInvoiceStatus } from "@/lib/invoices/operations";
import { sendInvoiceEmail } from "@/lib/invoices/email";
import { prisma } from "@/lib/db";

const INVOICE_ID = "cmmxo9xox0000p8nv1528hmdr";
const EXPECTED_NUMBER = "PS04";

async function main() {
  // 1. Fetch the invoice
  const invoice = await getInvoice(INVOICE_ID);
  if (!invoice) {
    throw new Error(`Invoice ${INVOICE_ID} not found`);
  }
  if (invoice.invoiceNumber !== EXPECTED_NUMBER) {
    throw new Error(`Expected ${EXPECTED_NUMBER}, got ${invoice.invoiceNumber}`);
  }
  if (invoice.status !== "draft") {
    throw new Error(`Invoice is already "${invoice.status}", expected "draft"`);
  }

  console.log(`Found invoice ${invoice.invoiceNumber} (${invoice.workspaceSlug})`);
  console.log(`  Total: £${(invoice.totalPence / 100).toFixed(2)}`);
  console.log(`  Status: ${invoice.status}`);

  // 2. Get billing email from workspace
  const workspace = await prisma.workspace.findUnique({
    where: { slug: invoice.workspaceSlug },
    select: { billingClientEmail: true },
  });

  const recipientEmail = workspace?.billingClientEmail;
  if (!recipientEmail) {
    throw new Error(`No billingClientEmail configured for workspace ${invoice.workspaceSlug}`);
  }
  console.log(`  Sending to: ${recipientEmail}`);

  // 3. Send the email with PDF attachment
  console.log("\nSending invoice email...");
  const delivery = await sendInvoiceEmail(invoice, recipientEmail);
  if (!delivery.delivered) {
    throw new Error("Invoice email delivery is not configured");
  }
  console.log("Email sent successfully.");

  // 4. Update status to "sent" (sets sentAt)
  const updated = await updateInvoiceStatus(INVOICE_ID, "sent");
  console.log(`\nInvoice status updated: ${updated.status}`);
  console.log(`  sentAt: ${updated.sentAt}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("ERROR:", err);
  await prisma.$disconnect();
  process.exit(1);
});
