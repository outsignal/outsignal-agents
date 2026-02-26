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

/**
 * Random delay between actions (30-90 seconds) for human-like behaviour.
 */
export function getActionDelay(): number {
  return 30_000 + Math.random() * 60_000;
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
