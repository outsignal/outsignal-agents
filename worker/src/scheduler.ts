/**
 * Scheduler — controls when actions should execute.
 *
 * Enforces business hours per timezone and adds human-like
 * random delays between actions.
 */

interface ScheduleConfig {
  /** IANA timezone, e.g. "Europe/London" */
  timezone: string;
  /** Start hour (inclusive), 0-23. Default 8 */
  startHour: number;
  /** End hour (exclusive), 0-23. Default 18 */
  endHour: number;
  /** Days of week to run (0=Sun, 6=Sat). Default Mon-Fri */
  activeDays: number[];
}

/** UK business hours (Jonathan's LinkedIn account). Mon-Fri 8 AM – 6 PM London time. */
const DEFAULT_CONFIG: ScheduleConfig = {
  timezone: "Europe/London",
  startHour: 8,
  endHour: 18,
  activeDays: [1, 2, 3, 4, 5], // Mon-Fri
};

/**
 * Check if we're currently within business hours.
 */
export function isWithinBusinessHours(config: Partial<ScheduleConfig> = {}): boolean {
  // Allow 24/7 override for testing via env var
  if (process.env.SCHEDULE_OVERRIDE === "always") return true;

  const { timezone, startHour, endHour, activeDays } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";

  // Map weekday string to number
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const dayNum = dayMap[weekday] ?? -1;

  if (!activeDays.includes(dayNum)) return false;
  if (hour < startHour || hour >= endHour) return false;

  return true;
}

/**
 * Calculate milliseconds until the next business hours window opens.
 */
export function msUntilBusinessHours(config: Partial<ScheduleConfig> = {}): number {
  const { timezone, startHour, activeDays } = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const now = new Date();

  // Try each of the next 7 days
  for (let dayOffset = 0; dayOffset < 8; dayOffset++) {
    const candidate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);

    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
      weekday: "short",
    });
    const parts = formatter.formatToParts(candidate);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dayNum = dayMap[weekday] ?? -1;

    if (!activeDays.includes(dayNum)) continue;

    // Set to start hour in the target timezone
    // Use a simple approach: set candidate to start of day + startHour
    const dayStart = new Date(candidate);
    dayStart.setHours(startHour, 0, 0, 0);

    // Adjust for timezone offset difference
    const localFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    // For the first iteration (today), only valid if start hour hasn't passed
    if (dayOffset === 0) {
      const currentHour = parseInt(
        parts.find((p) => p.type === "hour")?.value ?? "0",
        10,
      );
      if (currentHour >= startHour) continue;
    }

    // Calculate rough ms until startHour on that day
    const msPerDay = 24 * 60 * 60 * 1000;
    const msPerHour = 60 * 60 * 1000;

    if (dayOffset === 0) {
      // Same day — calculate hours remaining until startHour
      const currentHour = parseInt(
        parts.find((p) => p.type === "hour")?.value ?? "0",
        10,
      );
      return (startHour - currentHour) * msPerHour;
    }

    // Future day — rough estimate
    return dayOffset * msPerDay - (now.getHours() * msPerHour) + (startHour * msPerHour);
  }

  // Fallback: wait 1 hour
  return 60 * 60 * 1000;
}

/** Minimum spread delay (3 min) — below this, actions start to look automated. */
export const SPREAD_MIN_DELAY = 180_000;

/** Maximum spread delay (30 min) — above this, worker falls further and further behind schedule. */
export const SPREAD_MAX_DELAY = 1_800_000;

/** Fallback when inputs are degenerate (no budget remaining, past business hours, etc.). */
export const SPREAD_FALLBACK_DELAY = 300_000;

/**
 * Calculate delay between actions to spread them evenly across remaining business hours.
 *
 * IMPORTANT: `totalDailyRemaining` is the TOTAL daily budget remaining across
 * ALL action types for this sender (connections + messages + views), NOT the
 * current batch size. Using the batch size caused a front-loading bug where a
 * worker fetching 5 actions at 10 AM with 8h left would use 8h/5 = 30min spread
 * (clamped to MAX), drain all 5 in ~2.5h, then poll and fetch 5 more — consuming
 * the full daily budget by lunchtime instead of spreading across 10h business
 * window. James B-S sent 14 completions in 2h (10:29-12:19) on 2026-04-14.
 *
 * @param remainingMs - milliseconds until end of business window today
 * @param totalDailyRemaining - total actions left in today's budget across all types
 * @returns delay in milliseconds, with ±20% random jitter, clamped to [MIN, MAX]
 */
export function getSpreadDelay(
  remainingMs: number,
  totalDailyRemaining: number,
): number {
  if (totalDailyRemaining <= 0) return SPREAD_FALLBACK_DELAY;
  if (remainingMs <= 0) return SPREAD_FALLBACK_DELAY;

  const targetDelay = remainingMs / totalDailyRemaining;

  // Add ±20% random jitter
  const jitter = 0.8 + Math.random() * 0.4;
  const jittered = targetDelay * jitter;

  return Math.max(SPREAD_MIN_DELAY, Math.min(SPREAD_MAX_DELAY, jittered));
}

/**
 * Extract the current London wall-clock hour/minute regardless of whether
 * London is on GMT (winter, UTC+0) or BST (summer, UTC+1). Using raw UTC
 * hours drifts by 1h during BST, which caused the spread math to believe
 * the business day ended an hour later than it actually did — the 6 PM
 * cut-off was computed as 5 PM UK during BST, leaving one extra hour for
 * actions that would then drain outside business hours.
 */
export function getLondonHoursMinutes(
  now: Date = new Date(),
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minutePart = parts.find((p) => p.type === "minute")?.value ?? "0";
  // `en-GB` with `hour: "2-digit"` can return "24" at midnight — normalise.
  const rawHour = parseInt(hourPart, 10);
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = parseInt(minutePart, 10);
  return { hour, minute };
}

/**
 * Compute milliseconds until end of today's business window in London time.
 * Uses Intl.DateTimeFormat with `timeZone: "Europe/London"` to follow the
 * same pattern as isWithinBusinessHours, so the cutoff lands at the correct
 * wall-clock hour regardless of GMT/BST.
 *
 * Pre-business-hours clamp: if the current London hour is BEFORE the
 * business-start hour (e.g. 07:00), the raw subtraction `18 - 7 = 11h`
 * overstates the runway by 1h — the real business window is only 08:00–18:00
 * (10h). We clamp the current hour to `businessStartHour` so the returned
 * duration never exceeds the full business window length. Defaults mirror
 * DEFAULT_CONFIG (start 08:00, end 18:00).
 */
export function getRemainingBusinessMs(
  businessEndHour: number = DEFAULT_CONFIG.endHour,
  businessStartHour: number = DEFAULT_CONFIG.startHour,
): number {
  const { hour, minute } = getLondonHoursMinutes();
  const currentHourLondon = hour + minute / 60;
  const effectiveHour = Math.max(currentHourLondon, businessStartHour);
  const remainingHours = Math.max(0, businessEndHour - effectiveHour);
  return remainingHours * 60 * 60 * 1000;
}

/**
 * Random delay between actions (3-5 minutes) for human-like behaviour.
 * Fallback when spread delay data is unavailable.
 */
export function getActionDelay(): number {
  return 180_000 + Math.random() * 120_000;
}

/**
 * Random delay for the poll interval (2-5 minutes).
 */
export function getPollDelay(): number {
  return 120_000 + Math.random() * 180_000;
}

/**
 * Sleep helper.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
