const LONDON_TIMEZONE = "Europe/London";
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;
const ACTIVE_DAYS = new Set([1, 2, 3, 4, 5]);

interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

function getTimezoneOffsetMs(timezone: string, date: Date): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}

function getLondonParts(date: Date): LondonParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const rawHour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");

  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? "1970"),
    month: Number(parts.find((part) => part.type === "month")?.value ?? "1"),
    day: Number(parts.find((part) => part.type === "day")?.value ?? "1"),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? "0"),
    second: Number(parts.find((part) => part.type === "second")?.value ?? "0"),
    weekday: dayMap[weekday] ?? 1,
  };
}

function buildLondonDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  const reference = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  const offset = getTimezoneOffsetMs(LONDON_TIMEZONE, reference);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset);
}

function getBusinessBoundary(date: Date, hour: number): Date {
  const parts = getLondonParts(date);
  return buildLondonDate(parts.year, parts.month, parts.day, hour, 0, 0, 0);
}

function getNextBusinessStart(date: Date): Date {
  const parts = getLondonParts(date);
  for (let offset = 1; offset <= 7; offset++) {
    const candidate = buildLondonDate(
      parts.year,
      parts.month,
      parts.day + offset,
      BUSINESS_START_HOUR,
      0,
      0,
      0,
    );
    if (ACTIVE_DAYS.has(getLondonParts(candidate).weekday)) {
      return candidate;
    }
  }

  return buildLondonDate(
    parts.year,
    parts.month,
    parts.day + 1,
    BUSINESS_START_HOUR,
    0,
    0,
    0,
  );
}

/**
 * Shift a scheduled LinkedIn action into the next valid London business slot.
 *
 * If a chained step spills past 18:00 London, we preserve the overflow into the
 * next business day instead of leaving the action stranded overnight. Weekend
 * timestamps keep their within-window offset when moved to Monday.
 */
export function normalizeToLondonBusinessHours(date: Date): Date {
  let candidate = new Date(date);

  for (let i = 0; i < 10; i++) {
    const parts = getLondonParts(candidate);
    const start = getBusinessBoundary(candidate, BUSINESS_START_HOUR);
    const end = getBusinessBoundary(candidate, BUSINESS_END_HOUR);

    if (ACTIVE_DAYS.has(parts.weekday) && candidate >= start && candidate < end) {
      return candidate;
    }

    if (ACTIVE_DAYS.has(parts.weekday) && candidate < start) {
      return start;
    }

    if (candidate >= end) {
      const overflowMs = candidate.getTime() - end.getTime();
      candidate = new Date(getNextBusinessStart(candidate).getTime() + overflowMs);
      continue;
    }

    const nextStart = getNextBusinessStart(candidate);
    if (!ACTIVE_DAYS.has(parts.weekday)) {
      const offsetWithinWindowMs = Math.max(0, candidate.getTime() - start.getTime());
      candidate = new Date(nextStart.getTime() + offsetWithinWindowMs);
      continue;
    }

    candidate = nextStart;
  }

  return candidate;
}
