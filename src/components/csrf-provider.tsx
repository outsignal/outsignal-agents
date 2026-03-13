"use client";

import { useEffect } from "react";

/**
 * CsrfProvider — fetches a CSRF token on mount and patches window.fetch
 * to automatically include the x-csrf-token header on mutation requests.
 *
 * Add this to the root layout to enable CSRF protection across all forms.
 */
export function CsrfProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let csrfToken: string | null = null;
    const originalFetch = window.fetch;

    // Fetch CSRF token
    originalFetch("/api/csrf", { credentials: "same-origin" })
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data?.token) csrfToken = data.token;
      })
      .catch(() => {
        // Silently fail — unauthenticated pages won't get a token
      });

    // Patch fetch to auto-include CSRF header on mutations
    window.fetch = function patchedFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      if (!csrfToken || !init?.method) {
        return originalFetch(input, init);
      }

      const method = init.method.toUpperCase();
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        const headers = new Headers(init.headers);
        if (!headers.has("x-csrf-token")) {
          headers.set("x-csrf-token", csrfToken);
        }
        return originalFetch(input, { ...init, headers });
      }

      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return <>{children}</>;
}
