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

// Outsignal brand palette
const BRAND = {
  primary: "#F0FF7A",       // Yellow-green
  dark: "#18181b",          // Zinc-900
  darkMuted: "#27272a",     // Zinc-800
  text: "#18181b",
  textMuted: "#52525b",     // Zinc-600
  textLight: "#71717a",     // Zinc-500
  border: "#e4e4e7",        // Zinc-200
  metaBg: "#f4f4f5",        // Zinc-100
  white: "#ffffff",
  amountDue: "#dc2626",     // Red-600
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: BRAND.text,
    paddingTop: 48,
    paddingBottom: 48,
    paddingLeft: 48,
    paddingRight: 48,
  },

  // ── Title row: "I N V O I C E" + horizontal rule ──
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 36,
  },
  invoiceTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: BRAND.dark,
    letterSpacing: 7,
    textTransform: "uppercase",
    marginRight: 16,
  },
  titleRule: {
    flex: 1,
    height: 1.5,
    backgroundColor: BRAND.primary,
  },

  // ── Address section ──
  addressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  senderBlock: {
    flex: 1,
  },
  senderName: {
    fontSize: 16,
    fontFamily: "Helvetica",
    color: BRAND.dark,
    marginBottom: 8,
  },
  senderText: {
    fontSize: 10,
    color: BRAND.text,
    lineHeight: 1.6,
  },
  billToBlock: {
    flex: 1,
    alignItems: "flex-end",
  },
  billToLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: BRAND.textLight,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  billToCompany: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BRAND.dark,
    textTransform: "uppercase",
    marginBottom: 4,
    textAlign: "right",
  },
  billToText: {
    fontSize: 10,
    color: BRAND.text,
    lineHeight: 1.6,
    textAlign: "right",
  },

  // ── Metadata bar ──
  metaBar: {
    flexDirection: "row",
    backgroundColor: BRAND.dark,
    borderRadius: 4,
    marginBottom: 28,
    overflow: "hidden",
  },
  metaCell: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  metaCellAmount: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: BRAND.darkMuted,
  },
  metaLabel: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: BRAND.textLight,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: BRAND.white,
  },
  metaValueAmount: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: BRAND.primary,
  },

  // ── Table header ──
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: BRAND.dark,
    marginBottom: 2,
  },
  tableHeaderCell: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: BRAND.dark,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  // ── Table rows ──
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: BRAND.border,
  },
  colDescription: { flex: 3 },
  colQuantity: { flex: 1, textAlign: "center" },
  colUnitPrice: { flex: 1.5, textAlign: "right" },
  colAmount: { flex: 1.5, textAlign: "right" },
  rowText: {
    fontSize: 10,
    color: BRAND.text,
  },
  rowTextCenter: {
    fontSize: 10,
    color: BRAND.text,
    textAlign: "center",
  },
  rowTextRight: {
    fontSize: 10,
    color: BRAND.text,
    textAlign: "right",
  },

  // ── Bottom section: notes left, totals right ──
  bottomSection: {
    flexDirection: "row",
    marginTop: 32,
    borderTopWidth: 1.5,
    borderTopColor: BRAND.border,
    paddingTop: 20,
  },
  notesBlock: {
    flex: 1,
    paddingRight: 32,
  },
  notesLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: BRAND.dark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  notesText: {
    fontSize: 9,
    color: BRAND.textMuted,
    lineHeight: 1.7,
  },
  totalsBlock: {
    width: 220,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
  },
  totalsLabel: {
    fontSize: 10,
    color: BRAND.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  totalsValue: {
    fontSize: 10,
    color: BRAND.text,
    textAlign: "right",
  },
  totalsDivider: {
    height: 1.5,
    backgroundColor: BRAND.dark,
    marginVertical: 6,
  },
  totalFinalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  totalFinalLabel: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: BRAND.dark,
    textTransform: "uppercase",
  },
  totalFinalValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: BRAND.dark,
    textAlign: "right",
  },
});

/**
 * Parse a stored address string into display lines.
 * Handles both newline-separated (from billing fields) and
 * comma-separated (legacy manual entries) formats.
 * Groups: line1 + line2 (optional) → city → postcode
 */
function parseAddress(raw: string | null): string[] {
  if (!raw) return [];
  if (raw.includes("\n")) return raw.split("\n").filter(Boolean);

  // Legacy comma-separated: "Arkwright House, Parsonage Gardens, Manchester, M3 2LF"
  // Group into: "Arkwright House, Parsonage Gardens" / "Manchester" / "M3 2LF"
  const parts = raw.split(", ").filter(Boolean);
  if (parts.length <= 1) return parts;
  if (parts.length <= 3) return parts;

  // 4+ parts: join first N-2 as address lines, then city, then postcode
  const postcode = parts[parts.length - 1];
  const city = parts[parts.length - 2];
  const streetLines = parts.slice(0, -2).join(", ");
  return [streetLines, city, postcode];
}

interface InvoicePdfDocumentProps {
  invoice: InvoiceWithLineItems;
}

export function InvoicePdfDocument({ invoice }: InvoicePdfDocumentProps) {
  const addressLines = parseAddress(invoice.senderAddress);
  const clientLines = parseAddress(invoice.clientAddress);

  const dueDateLabel = formatInvoiceDate(invoice.dueDate);
  const issueDateLabel = formatInvoiceDate(invoice.issueDate);

  const bankDetailsLines = invoice.bankDetails
    ? invoice.bankDetails.includes("\n")
      ? invoice.bankDetails.split("\n").filter(Boolean)
      : invoice.bankDetails.split(", ").filter(Boolean)
    : [];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Title: "I N V O I C E" + rule ── */}
        <View style={styles.titleRow}>
          <Text style={styles.invoiceTitle}>I N V O I C E</Text>
          <View style={styles.titleRule} />
        </View>

        {/* ── Address: sender left, bill-to right ── */}
        <View style={styles.addressRow}>
          <View style={styles.senderBlock}>
            <Text style={styles.senderName}>{invoice.senderName}</Text>
            {addressLines.map((line, i) => (
              <Text key={i} style={styles.senderText}>
                {line}
              </Text>
            ))}
            {invoice.senderEmail && (
              <Text style={styles.senderText}>{invoice.senderEmail}</Text>
            )}
          </View>
          <View style={styles.billToBlock}>
            <Text style={styles.billToLabel}>Bill To:</Text>
            {invoice.clientCompanyName && (
              <Text style={styles.billToCompany}>
                {invoice.clientCompanyName}
              </Text>
            )}
            {clientLines.map((line, i) => (
              <Text key={i} style={styles.billToText}>
                {line}
              </Text>
            ))}
          </View>
        </View>

        {/* ── Metadata bar ── */}
        <View style={styles.metaBar}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Invoice #</Text>
            <Text style={styles.metaValue}>{invoice.invoiceNumber}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Invoice Date</Text>
            <Text style={styles.metaValue}>{issueDateLabel}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Due Date</Text>
            <Text style={styles.metaValue}>{dueDateLabel}</Text>
          </View>
          <View style={styles.metaCellAmount}>
            <Text style={styles.metaLabel}>Amount Due</Text>
            <Text style={styles.metaValueAmount}>
              {formatGBP(invoice.totalPence)}
            </Text>
          </View>
        </View>

        {/* ── Line items table ── */}
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, styles.colDescription]}>
            Items
          </Text>
          <Text style={[styles.tableHeaderCell, styles.colQuantity]}>
            Quantity
          </Text>
          <Text
            style={[
              styles.tableHeaderCell,
              styles.colUnitPrice,
              { textAlign: "right" },
            ]}
          >
            Price
          </Text>
          <Text
            style={[
              styles.tableHeaderCell,
              styles.colAmount,
              { textAlign: "right" },
            ]}
          >
            Amount
          </Text>
        </View>

        {invoice.lineItems.map((item) => (
          <View key={item.id} style={styles.tableRow}>
            <Text style={[styles.rowText, styles.colDescription]}>
              {item.description}
            </Text>
            <Text style={[styles.rowTextCenter, styles.colQuantity]}>
              {item.quantity.toFixed(1)}
            </Text>
            <Text style={[styles.rowTextRight, styles.colUnitPrice]}>
              {formatGBP(item.unitPricePence)}
            </Text>
            <Text style={[styles.rowTextRight, styles.colAmount]}>
              {formatGBP(item.amountPence)}
            </Text>
          </View>
        ))}

        {/* ── Bottom: notes left, totals right ── */}
        <View style={styles.bottomSection}>
          {/* Notes / bank details */}
          <View style={styles.notesBlock}>
            {bankDetailsLines.length > 0 && (
              <>
                <Text style={styles.notesLabel}>Notes:</Text>
                {bankDetailsLines.map((line, i) => (
                  <Text key={i} style={styles.notesText}>
                    {line}
                  </Text>
                ))}
              </>
            )}
          </View>

          {/* Totals */}
          <View style={styles.totalsBlock}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Sub-Total</Text>
              <Text style={styles.totalsValue}>
                {formatGBP(invoice.subtotalPence)}
              </Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax Rate</Text>
              <Text style={styles.totalsValue}>{invoice.taxRate}%</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Tax</Text>
              <Text style={styles.totalsValue}>
                {formatGBP(invoice.taxAmountPence)}
              </Text>
            </View>
            <View style={styles.totalsDivider} />
            <View style={styles.totalFinalRow}>
              <Text style={styles.totalFinalLabel}>Total</Text>
              <Text style={styles.totalFinalValue}>
                {formatGBP(invoice.totalPence)}
              </Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}
