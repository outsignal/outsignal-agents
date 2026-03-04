// Shared signal types for the worker-signals package.
// Used by PredictLeads adapters and the signals.ts DB writer.

import type { SignalType } from "./predictleads/types.js";

/**
 * Intermediate signal record — output of each adapter, input to writeSignalEvents().
 * Adapters produce these; signals.ts writes them to the DB as SignalEvent rows.
 */
export interface SignalInput {
  signalType: SignalType;
  source: "predictleads" | "serper";
  externalId: string | null;
  companyDomain: string;
  companyName?: string;
  title?: string;
  summary?: string;
  confidence?: number;
  sourceUrl?: string;
  rawResponse: string; // JSON.stringify of raw API item
  metadata?: string;  // JSON.stringify of extra structured data
}
