import { isWithinBusinessHours } from "./scheduler.js";

export const POLL_STALE_THRESHOLD_MS = 5 * 60 * 1000;

export type WorkerPlannedSleepReason =
  | "between_ticks"
  | "outside_business_hours"
  | "spread_delay";

export interface WorkerHealthSnapshotInput {
  lastPollTickAt: number | null;
  activeSleepUntil: number | null;
  activeSleepReason: WorkerPlannedSleepReason | null;
}

export interface WorkerHealthSnapshot {
  workerHealthy: boolean;
  lastPollTickAt: string | null;
  pollAgeSeconds: number | null;
  businessHoursActive: boolean;
  interpretation: string;
}

function describeSleepReason(reason: WorkerPlannedSleepReason | null): string {
  switch (reason) {
    case "outside_business_hours":
      return "Outside business hours";
    case "spread_delay":
      return "Worker is in an intentional spread delay";
    case "between_ticks":
      return "Worker is waiting for the next scheduled poll tick";
    default:
      return "Worker is in an expected sleep window";
  }
}

export function buildWorkerHealthSnapshot(
  input: WorkerHealthSnapshotInput,
  opts: {
    now?: Date;
    businessHoursActive?: boolean;
  } = {},
): WorkerHealthSnapshot {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const businessHoursActive =
    opts.businessHoursActive ?? isWithinBusinessHours();
  const pollAgeMs =
    input.lastPollTickAt === null ? null : Math.max(0, nowMs - input.lastPollTickAt);
  const activeSleep =
    input.activeSleepUntil !== null && input.activeSleepUntil > nowMs;

  if (!businessHoursActive) {
    return {
      workerHealthy: true,
      lastPollTickAt:
        input.lastPollTickAt === null
          ? null
          : new Date(input.lastPollTickAt).toISOString(),
      pollAgeSeconds:
        pollAgeMs === null ? null : Math.floor(pollAgeMs / 1000),
      businessHoursActive,
      interpretation: "Outside business hours; poll silence is expected",
    };
  }

  if (activeSleep) {
    return {
      workerHealthy: true,
      lastPollTickAt:
        input.lastPollTickAt === null
          ? null
          : new Date(input.lastPollTickAt).toISOString(),
      pollAgeSeconds:
        pollAgeMs === null ? null : Math.floor(pollAgeMs / 1000),
      businessHoursActive,
      interpretation: describeSleepReason(input.activeSleepReason),
    };
  }

  if (input.lastPollTickAt === null) {
    return {
      workerHealthy: false,
      lastPollTickAt: null,
      pollAgeSeconds: null,
      businessHoursActive,
      interpretation: "Worker has not recorded its first poll tick yet",
    };
  }

  const ageMs = pollAgeMs ?? Number.POSITIVE_INFINITY;
  const workerHealthy = ageMs < POLL_STALE_THRESHOLD_MS;
  return {
    workerHealthy,
    lastPollTickAt: new Date(input.lastPollTickAt).toISOString(),
    pollAgeSeconds: Math.floor(ageMs / 1000),
    businessHoursActive,
    interpretation: workerHealthy
      ? "Worker polling normally"
      : "Worker loop stalled during business hours",
  };
}
