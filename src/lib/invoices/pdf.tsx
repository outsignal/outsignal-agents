/**
 * Invoice PDF document component using @react-pdf/renderer.
 *
 * SERVER-ONLY. Never import in a "use client" component.
 * Only import from API routes (e.g. /api/invoices/[id]/pdf).
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { InvoiceWithLineItems } from "./types";
import { formatGBP, formatInvoiceDate } from "./format";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#18181b",
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 48,
    paddingRight: 48,
  },
  // Header
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  invoiceTitle: {
    fontSize: 24,
    fontFamily: "Helvetica-Bold",
    color: "#18181b",
    marginBottom: 16,
  },
  senderBlock: {
    flex: 1,
  },
  billToBlock: {
    flex: 1,
    alignItems: "flex-end",
  },
  blockLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  blockText: {
    fontSize: 10,
    color: "#18181b",
    lineHeight: 1.5,
  },
  // Metadata bar
  metaBar: {
    flexDirection: "row",
    backgroundColor: "#f4f4f5",
    borderRadius: 4,
    padding: 12,
    marginBottom: 24,
    gap: 0,
  },
  metaCell: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#18181b",
  },
  // Line items table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#18181b",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 3,
    marginBottom: 4,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },
  tableRowAlt: {
    backgroundColor: "#fafafa",
  },
  colDescription: { flex: 3 },
  colQuantity: { flex: 1, textAlign: "right" },
  colUnitPrice: { flex: 1.5, textAlign: "right" },
  colAmount: { flex: 1.5, textAlign: "right" },
  rowText: {
    fontSize: 10,
    color: "#18181b",
  },
  rowTextRight: {
    fontSize: 10,
    color: "#18181b",
    textAlign: "right",
  },
  // Totals section
  totalsSection: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
    marginBottom: 24,
  },
  totalsTable: {
    width: 240,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },
  totalsRowBold: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    backgroundColor: "#18181b",
    paddingHorizontal: 8,
    borderRadius: 3,
    marginTop: 4,
  },
  totalsLabel: {
    fontSize: 10,
    color: "#52525b",
  },
  totalsValue: {
    fontSize: 10,
    color: "#18181b",
    textAlign: "right",
  },
  totalsBoldLabel: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  totalsBoldValue: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#F0FF7A",
    textAlign: "right",
  },
  // Notes section
  notesSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#e4e4e7",
    paddingTop: 16,
  },
  notesLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#71717a",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  notesText: {
    fontSize: 9,
    color: "#52525b",
    lineHeight: 1.6,
  },
});

interface InvoicePdfDocumentProps {
  invoice: InvoiceWithLineItems;
}

export function InvoicePdfDocument({ invoice }: InvoicePdfDocumentProps) {
  const senderLines = [
    invoice.senderName,
    ...(invoice.senderAddress ? invoice.senderAddress.split("\n") : []),
    invoice.senderEmail,
  ].filter(Boolean);

  const clientLines = [
    invoice.clientCompanyName,
    ...(invoice.clientAddress ? invoice.clientAddress.split("\n") : []),
  ].filter(Boolean);

  const dueDateLabel = formatInvoiceDate(invoice.dueDate);
  const issueDateLabel = formatInvoiceDate(invoice.issueDate);

  const bankDetailsLines = invoice.bankDetails
    ? invoice.bankDetails.split("\n")
    : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Title */}
        <Text style={styles.invoiceTitle}>INVOICE</Text>

        {/* Two-column header: sender left, bill-to right */}
        <View style={styles.headerRow}>
          <View style={styles.senderBlock}>
            <Text style={styles.blockLabel}>From</Text>
            {senderLines.map((line, i) => (
              <Text key={i} style={styles.blockText}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.billToBlock}>
            <Text style={styles.blockLabel}>Bill To</Text>
            {clientLines.map((line, i) => (
              <Text key={i} style={styles.blockText}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* Metadata bar: Invoice #, Date, Due Date, Amount Due */}
        <View style={styles.metaBar}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Invoice #</Text>
            <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>{issueDateLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Due Date</Text>
            <Text style={styles.metaValue}>{dueDateLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Amount Due</Text>
            <Text style={styles.metaValue}>{formatGBP(invoice.totalPence)}</Text>
          </View>
        </View>

        {/* Line items table */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.colDescription]}>
            Description
          </Text>
          <Text style={[styles.tableHeaderCell, styles.colQuantity]}>
            Qty
          </Text>
          <Text style={[styles.tableHeaderCell, styles.colUnitPrice]}>
            Unit Price
          </Text>
          <Text style={[styles.tableHeaderCell, styles.colAmount]}>
            Amount
          </Text>
        </View>

        {invoice.lineItems.map((item, index) => (
          <View
            key={item.id}
            style={[styles.tableRow, index % 2 !== 0 ? styles.tableRowAlt : {}]}
          >
            <Text style={[styles.rowText, styles.colDescription]}>
              {item.description}
            </Text>
            <Text style={[styles.rowTextRight, styles.colQuantity]}>
              {item.quantity}
            </Text>
            <Text style={[styles.rowTextRight, styles.colUnitPrice]}>
              {formatGBP(item.unitPricePence)}
            </Text>
            <Text style={[styles.rowTextRight, styles.colAmount]}>
              {formatGBP(item.amountPence)}
            </Text>
          </View>
        ))}

        {/* Totals section */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsTable}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>
                {formatGBP(invoice.subtotalPence)}
              </Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>
                Tax ({invoice.taxRate}%)
              </Text>
              <Text style={styles.totalsValue}>
                {formatGBP(invoice.taxAmountPence)}
              </Text>
            </View>
            <View style={styles.totalsRowBold}>
              <Text style={styles.totalsBoldLabel}>Total</Text>
              <Text style={styles.totalsBoldValue}>
                {formatGBP(invoice.totalPence)}
              </Text>
            </View>
          </View>
        </View>

        {/* Notes / Bank details */}
        {bankDetailsLines.length > 0 && (
          <View style={styles.notesSection}>
            <Text style={styles.notesLabel}>Notes</Text>
            {bankDetailsLines.map((line, i) => (
              <Text key={i} style={styles.notesText}>
                {line}
              </Text>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
