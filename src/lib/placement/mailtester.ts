// --- mail-tester.com API Client ---

import { MailTesterResponse, GOOD_THRESHOLD, WARNING_THRESHOLD } from "./types";

const LOG_PREFIX = "[placement/mailtester]";

/**
 * Returns the mail-tester.com API key from environment, or null if not set.
 * Graceful degradation: callers should check for null before using.
 */
export function getApiKey(): string | null {
  return process.env.MAILTESTER_API_KEY ?? null;
}

/**
 * Requests a unique test email address from mail-tester.com.
 * The returned address is used to send a test email. Once sent, poll
 * fetchTestResults() with the returned testId to get the score.
 *
 * API: GET https://www.mail-tester.com/api?key={apiKey}&format=json
 * Returns: { address: "test-xxx@srv1.mail-tester.com", id: "test-xxx" }
 */
export async function getTestAddress(
  apiKey: string
): Promise<{ testAddress: string; testId: string }> {
  const url = `https://www.mail-tester.com/api?key=${encodeURIComponent(apiKey)}&format=json`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(
      `${LOG_PREFIX} getTestAddress failed: HTTP ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as { address?: string; id?: string };

  if (!data.address || !data.id) {
    throw new Error(
      `${LOG_PREFIX} getTestAddress: unexpected response shape: ${JSON.stringify(data)}`
    );
  }

  return {
    testAddress: data.address,
    testId: data.id,
  };
}

/**
 * Fetches test results for a given testId from mail-tester.com.
 * Returns the parsed MailTesterResponse, or null if results are not yet ready.
 *
 * API: GET https://www.mail-tester.com/api?key={apiKey}&id={testId}&format=json
 */
export async function fetchTestResults(
  testId: string,
  apiKey: string
): Promise<MailTesterResponse | null> {
  const url = `https://www.mail-tester.com/api?key=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(testId)}&format=json`;

  const res = await fetch(url);

  if (!res.ok) {
    // 404 or 202 typically means results not ready yet
    if (res.status === 404 || res.status === 202) {
      return null;
    }
    throw new Error(
      `${LOG_PREFIX} fetchTestResults failed: HTTP ${res.status} ${res.statusText}`
    );
  }

  const data = (await res.json()) as { score?: number; id?: string; [key: string]: unknown };

  // If the API returns a result without a score, it's not ready yet
  if (data.score === undefined || data.score === null) {
    return null;
  }

  return {
    id: data.id ?? testId,
    score: data.score,
    details: data as MailTesterResponse["details"],
  };
}

/**
 * Polls mail-tester.com for results every intervalMs until results arrive
 * or maxAttempts is exhausted.
 *
 * Designed to respect Vercel's 60s function timeout:
 * default 6 attempts * 10s = 60s total.
 *
 * Returns MailTesterResponse if results arrived, null if still pending after
 * all attempts.
 */
export async function pollForResults(
  testId: string,
  apiKey: string,
  maxAttempts = 6,
  intervalMs = 10_000
): Promise<MailTesterResponse | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(
      `${LOG_PREFIX} pollForResults attempt ${attempt}/${maxAttempts} for testId=${testId}`
    );

    const result = await fetchTestResults(testId, apiKey);

    if (result !== null) {
      console.log(
        `${LOG_PREFIX} pollForResults got result on attempt ${attempt}: score=${result.score}`
      );
      return result;
    }

    // If this wasn't the last attempt, wait before retrying
    if (attempt < maxAttempts) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  console.log(
    `${LOG_PREFIX} pollForResults exhausted ${maxAttempts} attempts for testId=${testId} — still pending`
  );
  return null;
}

/**
 * Classifies a mail-tester.com score (0-10) into a health tier.
 * Uses GOOD_THRESHOLD (7) and WARNING_THRESHOLD (5) from types.ts.
 */
export function classifyScore(score: number): "good" | "warning" | "critical" {
  if (score >= GOOD_THRESHOLD) return "good";
  if (score >= WARNING_THRESHOLD) return "warning";
  return "critical";
}
