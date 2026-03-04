import { prisma } from "@/lib/db";

export async function getNextInvoiceNumber(
  workspaceSlug: string,
  prefix: string
): Promise<string> {
  const result = await prisma.$transaction(async (tx) => {
    const seq = await tx.invoiceSequence.upsert({
      where: { workspaceSlug },
      create: { workspaceSlug, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    return seq.lastNumber;
  });
  return `${prefix}${String(result).padStart(2, "0")}`;
}
