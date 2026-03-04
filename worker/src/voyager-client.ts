/**
 * VoyagerClient — LinkedIn Voyager API HTTP client.
 *
 * Replaces LinkedInBrowser for all LinkedIn action execution.
 * Makes direct HTTP requests to LinkedIn's internal Voyager REST API
 * using cookie-based authentication (li_at + JSESSIONID) and HTTP/SOCKS5
 * proxy routing via undici ProxyAgent (HTTP) or fetch-socks (SOCKS5).
 *
 * Key design decisions:
 * - Uses Node.js native fetch (global, Node 18+) with undici dispatcher for proxy
 * - Proxy dispatcher created once in constructor, reused for all requests
 * - CSRF token = JSESSIONID with quotes stripped (high-confidence pattern)
 * - viewProfile() always called first to extract memberUrn for write ops
 * - Each sender gets its own VoyagerClient instance — no shared sessions
 */

import { socksDispatcher } from "fetch-socks";
import { ProxyAgent } from "undici";

// NOTE: This ConnectionStatus matches worker/src/linkedin-browser.ts, NOT
// src/lib/linkedin/types.ts. The shared server type uses different values
// (none/failed/expired). VoyagerClient only runs in the worker context.
export type ConnectionStatus =
  | "connected"
  | "pending"
  | "not_connected"
  | "not_connectable"
  | "unknown";

export interface ActionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export class VoyagerError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Voyager API error ${status}: ${body}`);
    this.name = "VoyagerError";
  }
}

export class VoyagerClient {
  private readonly liAt: string;
  private readonly jsessionId: string;
  private readonly csrfToken: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly proxyDispatcher: any;
  private readonly baseUrl = "https://www.linkedin.com/voyager/api";

  constructor(liAt: string, jsessionId: string, proxyUrl?: string) {
    this.liAt = liAt;
    // Strip surrounding quotes from JSESSIONID for CSRF token derivation
    // JSESSIONID stored form: "ajax:3972979001005769271"
    // CSRF token required form: ajax:3972979001005769271
    this.jsessionId = jsessionId;
    this.csrfToken = jsessionId.replace(/"/g, "");

    // Create proxy dispatcher — supports both HTTP(S) and SOCKS5 URLs
    if (proxyUrl) {
      const parsed = new URL(proxyUrl);
      if (parsed.protocol === "socks5:" || parsed.protocol === "socks5h:") {
        this.proxyDispatcher = socksDispatcher({
          type: 5,
          host: parsed.hostname,
          port: parseInt(parsed.port, 10),
          userId: parsed.username || undefined,
          password: parsed.password || undefined,
        });
      } else {
        // HTTP/HTTPS proxy — use undici's built-in ProxyAgent
        this.proxyDispatcher = new ProxyAgent(proxyUrl);
      }
    }
  }

  /**
   * Core HTTP request method. All Voyager API calls go through here.
   *
   * CRITICAL: undici uses `dispatcher` NOT `agent` for proxy routing.
   * Using `{ agent: proxyAgent }` silently does nothing — requests go direct.
   */
  private async request(
    path: string,
    options: RequestInit & { extraHeaders?: Record<string, string> } = {}
  ): Promise<Response> {
    const { extraHeaders, ...fetchOptions } = options;

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/vnd.linkedin.normalized+json+2.1",
      "Accept-Language": "en-US,en;q=0.9",
      "csrf-token": this.csrfToken,
      "x-restli-protocol-version": "2.0.0",
      "x-li-lang": "en_US",
      Cookie: `li_at=${this.liAt}; JSESSIONID="${this.jsessionId}"`,
      ...extraHeaders,
    };

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...fetchOptions,
      headers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(this.proxyDispatcher ? { dispatcher: this.proxyDispatcher as any } : {}),
    });

    // Detect checkpoint/challenge redirects (account under verification)
    if (
      response.url.includes("/checkpoint/") ||
      response.url.includes("/challenge/")
    ) {
      return response; // caller checks response.url for checkpoint
    }

    if (!response.ok) {
      const body = await response.text();
      throw new VoyagerError(response.status, body);
    }

    return response;
  }

  /**
   * Lightweight session health check.
   * Fetches /me (own mini-profile) — zero side effects, no rate limit pressure.
   * Returns true if cookies + proxy are working, false on any error.
   */
  async testSession(): Promise<boolean> {
    try {
      const response = await this.request("/me");
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Extract the profileId slug from a LinkedIn profile URL.
   * e.g. "https://www.linkedin.com/in/april-newman-27713482" → "april-newman-27713482"
   */
  private extractProfileId(profileUrl: string): string | null {
    const match = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  /**
   * View a LinkedIn profile and extract the memberUrn.
   *
   * Required before sendConnectionRequest() and sendMessage() — those write
   * operations need the memberUrn (ACoAAA...) not the URL slug.
   *
   * Returns memberUrn (without urn:li:fsd_profile: prefix) in details.memberUrn.
   */
  async viewProfile(profileUrl: string): Promise<ActionResult> {
    try {
      const profileId = this.extractProfileId(profileUrl);
      if (!profileId) {
        return { success: false, error: "invalid_profile_url" };
      }

      // Use /identity/dash/profiles endpoint (the old /identity/profiles/{id}/profileView
      // was deprecated by LinkedIn, returning 410 Gone)
      const response = await this.request(
        `/identity/dash/profiles?q=memberIdentity&memberIdentity=${profileId}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-6`
      );

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        return {
          success: false,
          error: "checkpoint_detected",
          details: { retry: false },
        };
      }

      const data = (await response.json()) as Record<string, unknown>;

      // Response is a collection — extract first element's entityUrn from included entities
      // The elements array contains URNs like "urn:li:fsd_profile:ACoAAA..."
      const elements = (data as Record<string, unknown[]>).data
        ? ((data as Record<string, Record<string, unknown[]>>).data?.["*elements"] ?? [])
        : [];

      const entityUrn = (elements[0] as string) ?? null;

      if (!entityUrn) {
        return {
          success: false,
          error: "urn_not_found",
          details: { profileId },
        };
      }

      const memberUrn = entityUrn.replace("urn:li:fsd_profile:", "");
      return { success: true, details: { memberUrn, profileId } };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * Send a LinkedIn connection request.
   *
   * Calls viewProfile() first to extract memberUrn. Then POSTs to
   * /voyagerRelationshipsDashMemberRelationships with the connection request payload.
   */
  async sendConnectionRequest(
    profileUrl: string,
    note?: string
  ): Promise<ActionResult> {
    try {
      // Always view profile first to extract memberUrn
      const profileResult = await this.viewProfile(profileUrl);
      if (!profileResult.success) {
        return profileResult;
      }

      const memberUrn = profileResult.details?.memberUrn as string;
      const profileId = profileResult.details?.profileId as string;

      // Validate note length (LinkedIn max is 300 characters)
      if (note && note.length > 300) {
        return { success: false, error: "note_too_long", details: { maxLength: 300 } };
      }

      const body = {
        invitee: {
          inviteeUnion: {
            memberProfile: `urn:li:fsd_profile:${memberUrn}`,
          },
        },
        customMessage: note || "",
      };

      const response = await this.request(
        `/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2`,
        {
          method: "POST",
          body: JSON.stringify(body),
          extraHeaders: {
            "Content-Type": "application/json",
            Referer: `https://www.linkedin.com/in/${profileId}/`,
          },
        }
      );

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        return {
          success: false,
          error: "checkpoint_detected",
          details: { retry: false },
        };
      }

      return { success: true, details: { memberUrn } };
    } catch (err) {
      // CANT_RESEND_YET = already sent an invite to this person
      if (err instanceof VoyagerError && err.status === 400) {
        return { success: false, error: "already_invited" };
      }
      return this.handleError(err);
    }
  }

  /**
   * Send a message to an existing 1st-degree LinkedIn connection.
   *
   * Only works for connected profiles — returns not_connected error
   * if the API returns 403 on messaging attempt.
   */
  async sendMessage(
    profileUrl: string,
    message: string
  ): Promise<ActionResult> {
    try {
      // Always view profile first to extract memberUrn
      const profileResult = await this.viewProfile(profileUrl);
      if (!profileResult.success) {
        return profileResult;
      }

      const memberUrn = profileResult.details?.memberUrn as string;

      const body = {
        recipients: [`urn:li:fsd_profile:${memberUrn}`],
        subject: "",
        body: message,
        messageType: "MEMBER_TO_MEMBER",
      };

      const response = await this.request("/messaging/conversations", {
        method: "POST",
        body: JSON.stringify(body),
        extraHeaders: {
          "Content-Type": "application/json",
        },
      });

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        return {
          success: false,
          error: "checkpoint_detected",
          details: { retry: false },
        };
      }

      return { success: true, details: { memberUrn } };
    } catch (err) {
      // 403 on messaging = not connected (can't message non-connections)
      if (err instanceof VoyagerError && err.status === 403) {
        return { success: false, error: "not_connected" };
      }
      return this.handleError(err);
    }
  }

  /**
   * Check the connection status with a LinkedIn profile.
   *
   * Extracts profileId from URL, GETs /identity/profiles/{id}/relationships,
   * and parses distanceOfConnection from the response.
   */
  async checkConnectionStatus(profileUrl: string): Promise<ConnectionStatus> {
    try {
      const profileId = this.extractProfileId(profileUrl);
      if (!profileId) {
        return "unknown";
      }

      const response = await this.request(
        `/identity/profiles/${profileId}/relationships`
      );

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        return "unknown";
      }

      const data = (await response.json()) as Record<string, unknown>;

      // Parse memberRelationship.distanceOfConnection
      const memberRelationship = data.memberRelationship as
        | Record<string, unknown>
        | undefined;
      const distance = memberRelationship?.distanceOfConnection as
        | string
        | undefined;

      if (distance === "DISTANCE_1") {
        return "connected";
      }

      if (distance === "DISTANCE_2" || distance === "DISTANCE_3") {
        // Check for pending invitation
        const invitation = memberRelationship?.invitation;
        return invitation ? "pending" : "not_connected";
      }

      return "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Centralized error handler for VoyagerError instances.
   * Maps LinkedIn-specific HTTP status codes to typed error results.
   */
  private handleError(err: unknown): ActionResult {
    if (err instanceof VoyagerError) {
      switch (err.status) {
        case 429:
          return {
            success: false,
            error: "rate_limited",
            details: { retry: true },
          };
        case 403:
          return {
            success: false,
            error: "auth_expired",
            details: { retry: false },
          };
        case 401:
          return {
            success: false,
            error: "unauthorized",
            details: { retry: false },
          };
        case 999:
          return {
            success: false,
            error: "ip_blocked",
            details: { retry: false },
          };
        default:
          return {
            success: false,
            error: `voyager_error_${err.status}`,
            details: { retry: false, body: err.body },
          };
      }
    }
    return { success: false, error: String(err) };
  }
}
