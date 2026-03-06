/**
 * Client-side CSRF token utilities (double-submit cookie pattern).
 *
 * Usage:
 *   import { getCsrfHeaders } from "@/lib/csrf-client";
 *
 *   const res = await fetch("/api/some-mutation", {
 *     method: "POST",
 *     headers: { "Content-Type": "application/json", ...(await getCsrfHeaders()) },
 *     body: JSON.stringify(data),
 *   });
 */

let cachedToken: string | null = null;

/**
 * Fetch a fresh CSRF token from the server and cache it in memory.
 * Call this once on app init or after a 403 to refresh the token.
 */
export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf", { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch CSRF token: ${res.status}`);
  }
  const { token } = await res.json();
  cachedToken = token;
  return token;
}

/**
 * Returns headers containing the CSRF token for use in mutation requests.
 * Automatically fetches a token if one isn't cached yet.
 */
export async function getCsrfHeaders(): Promise<{ "x-csrf-token": string }> {
  if (!cachedToken) {
    await fetchCsrfToken();
  }
  return { "x-csrf-token": cachedToken! };
}
