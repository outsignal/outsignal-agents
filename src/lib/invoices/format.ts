export function formatGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

export function penceToPounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

// Format date as DD/MM/YYYY for invoice display
export function formatInvoiceDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
