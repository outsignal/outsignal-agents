/**
 * Resend a copy of invoice PS04 to jonathan@outsignal.ai only.
 * Does NOT update invoice status.
 * Usage: npx tsx scripts/resend-ps04-to-jonathan.ts
 */
import { getInvoice } from "@/lib/invoices/operations";
import { sendInvoiceEmail } from "@/lib/invoices/email";
import { prisma } from "@/lib/db";

const INVOICE_ID = "cmmxo9xox0000p8nv1528hmdr";
const RECIPIENT = "jonathan@outsignal.ai";

async function main() {
  const invoice = await getInvoice(INVOICE_ID);
  if (!invoice) {
    throw new Error(`Invoice ${INVOICE_ID} not found`);
  }

  console.log(`Found invoice ${invoice.invoiceNumber} (${invoice.workspaceSlug})`);
  console.log(`  Total: £${(invoice.totalPence / 100).toFixed(2)}`);
  console.log(`  Status: ${invoice.status}`);
  console.log(`  Sending copy to: ${RECIPIENT}`);

  const delivery = await sendInvoiceEmail(invoice, RECIPIENT);
  if (!delivery.delivered) {
    throw new Error("Invoice email delivery is not configured");
  }
  console.log("Email sent successfully.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("ERROR:", err);
  await prisma.$disconnect();
  process.exit(1);
});
