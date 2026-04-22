export const PER_SENDER_TIMEOUT_MS = 20 * 60 * 1000;
export const SENDER_TIMEOUT_EXIT_BUFFER_MS = 2 * 60 * 1000;
export const HARD_SENDER_TIMEOUT_MS = 25 * 60 * 1000;

export function shouldExitSenderLoop({
  elapsedMs,
  nextDelayMs = 0,
  timeoutMs = PER_SENDER_TIMEOUT_MS,
  bufferMs = SENDER_TIMEOUT_EXIT_BUFFER_MS,
}: {
  elapsedMs: number;
  nextDelayMs?: number;
  timeoutMs?: number;
  bufferMs?: number;
}): boolean {
  return elapsedMs + nextDelayMs + bufferMs >= timeoutMs;
}
