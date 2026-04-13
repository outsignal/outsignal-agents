/**
 * Claude Code Token Budget Tracker
 *
 * Reads JSONL session logs from ~/.claude/projects/-Users-jjay-programs/
 * and aggregates token usage for the current 5-hour rolling window.
 *
 * Only scans files modified within the last 6 hours to avoid reading
 * ancient session files. Results are cached in-memory for 60 seconds.
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as os from "os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetSnapshot {
  totalWeight: number;
  windowHours: number;
  percentageUsed: number;
  bySession: Record<string, number>;
  recordCount: number;
  oldestRecord: Date | null;
  newestRecord: Date | null;
}

interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AssistantRecord {
  type: string;
  timestamp: string;
  sessionId: string;
  message?: {
    model?: string;
    usage?: TokenUsage;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JSONL_DIR = path.join(
  os.homedir(),
  ".claude",
  "projects",
  "-Users-jjay-programs",
);

const WINDOW_HOURS = 5;
const FILE_AGE_HOURS = 6; // only scan files modified within this window
const CACHE_TTL_MS = 60_000; // 60 seconds

const DEFAULT_BUDGET_LIMIT = 80_000_000; // 80M tokens

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cachedSnapshot: BudgetSnapshot | null = null;
let cacheTimestamp = 0;

/**
 * Clear the in-memory cache (useful for testing).
 */
export function clearCache(): void {
  cachedSnapshot = null;
  cacheTimestamp = 0;
}

// ---------------------------------------------------------------------------
// Weight calculation
// ---------------------------------------------------------------------------

function calculateWeight(usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return input + cacheCreation + output + cacheRead * 0.1;
}

// ---------------------------------------------------------------------------
// File scanning
// ---------------------------------------------------------------------------

async function getRecentJsonlFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    console.warn(`[budget-tracker] Cannot read directory: ${dir}`);
    return [];
  }

  const cutoff = Date.now() - FILE_AGE_HOURS * 60 * 60 * 1000;
  const result: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= cutoff) {
        result.push(fullPath);
      }
    } catch {
      // skip files we cannot stat
    }
  }

  return result;
}

async function parseJsonlFile(
  filePath: string,
  windowStart: Date,
): Promise<{
  bySession: Record<string, number>;
  recordCount: number;
  oldest: Date | null;
  newest: Date | null;
}> {
  const bySession: Record<string, number> = {};
  let recordCount = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;

  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let record: AssistantRecord;
    try {
      record = JSON.parse(line);
    } catch {
      // malformed line -- skip
      continue;
    }

    if (record.type !== "assistant") continue;
    if (!record.message?.usage) continue;
    if (!record.timestamp) continue;

    const ts = new Date(record.timestamp);
    if (isNaN(ts.getTime())) continue;
    if (ts < windowStart) continue;

    const weight = calculateWeight(record.message.usage);
    if (weight === 0) continue;

    const sessionId = record.sessionId || "unknown";
    bySession[sessionId] = (bySession[sessionId] || 0) + weight;
    recordCount++;

    if (!oldest || ts < oldest) oldest = ts;
    if (!newest || ts > newest) newest = ts;
  }

  return { bySession, recordCount, oldest, newest };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getBudgetLimit(): number {
  const envLimit = process.env.CLAUDE_BUDGET_LIMIT;
  if (envLimit) {
    const parsed = parseInt(envLimit, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_BUDGET_LIMIT;
}

/**
 * Get a snapshot of Claude Code token usage for a custom time window.
 * Unlike getBudgetSnapshot, this does NOT use the in-memory cache and
 * accepts a configurable window in hours.
 */
export async function getUsageSnapshot(
  windowHours: number,
  dir?: string,
): Promise<BudgetSnapshot> {
  const targetDir = dir || JSONL_DIR;
  const now = Date.now();
  const windowStart = new Date(now - windowHours * 60 * 60 * 1000);

  // Scan files modified within windowHours + 1h buffer
  const fileAgeCutoff = Date.now() - (windowHours + 1) * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = fs.readdirSync(targetDir);
  } catch {
    return {
      totalWeight: 0,
      windowHours,
      percentageUsed: 0,
      bySession: {},
      recordCount: 0,
      oldestRecord: null,
      newestRecord: null,
    };
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".jsonl")) continue;
    const fullPath = path.join(targetDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= fileAgeCutoff) {
        files.push(fullPath);
      }
    } catch {
      // skip
    }
  }

  const mergedSessions: Record<string, number> = {};
  let totalRecords = 0;
  let globalOldest: Date | null = null;
  let globalNewest: Date | null = null;

  for (const file of files) {
    const { bySession, recordCount, oldest, newest } = await parseJsonlFile(
      file,
      windowStart,
    );
    for (const [sid, weight] of Object.entries(bySession)) {
      mergedSessions[sid] = (mergedSessions[sid] || 0) + weight;
    }
    totalRecords += recordCount;
    if (oldest && (!globalOldest || oldest < globalOldest)) globalOldest = oldest;
    if (newest && (!globalNewest || newest > globalNewest)) globalNewest = newest;
  }

  const totalWeight = Object.values(mergedSessions).reduce(
    (sum, w) => sum + w,
    0,
  );
  const budgetLimit = getBudgetLimit();

  return {
    totalWeight,
    windowHours,
    percentageUsed: (totalWeight / budgetLimit) * 100,
    bySession: mergedSessions,
    recordCount: totalRecords,
    oldestRecord: globalOldest,
    newestRecord: globalNewest,
  };
}

/**
 * Get a snapshot of Claude Code token budget usage for the current
 * 5-hour rolling window.
 */
export async function getBudgetSnapshot(
  dir?: string,
): Promise<BudgetSnapshot> {
  const now = Date.now();

  // Return cached result if fresh
  if (cachedSnapshot && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSnapshot;
  }

  const targetDir = dir || JSONL_DIR;
  const windowStart = new Date(now - WINDOW_HOURS * 60 * 60 * 1000);
  const files = await getRecentJsonlFiles(targetDir);

  const mergedSessions: Record<string, number> = {};
  let totalRecords = 0;
  let globalOldest: Date | null = null;
  let globalNewest: Date | null = null;

  for (const file of files) {
    const { bySession, recordCount, oldest, newest } = await parseJsonlFile(
      file,
      windowStart,
    );

    for (const [sid, weight] of Object.entries(bySession)) {
      mergedSessions[sid] = (mergedSessions[sid] || 0) + weight;
    }
    totalRecords += recordCount;

    if (oldest && (!globalOldest || oldest < globalOldest))
      globalOldest = oldest;
    if (newest && (!globalNewest || newest > globalNewest))
      globalNewest = newest;
  }

  const totalWeight = Object.values(mergedSessions).reduce(
    (sum, w) => sum + w,
    0,
  );
  const budgetLimit = getBudgetLimit();

  const snapshot: BudgetSnapshot = {
    totalWeight,
    windowHours: WINDOW_HOURS,
    percentageUsed: (totalWeight / budgetLimit) * 100,
    bySession: mergedSessions,
    recordCount: totalRecords,
    oldestRecord: globalOldest,
    newestRecord: globalNewest,
  };

  // Cache result (only cache when using default dir)
  if (!dir) {
    cachedSnapshot = snapshot;
    cacheTimestamp = now;
  }

  return snapshot;
}
