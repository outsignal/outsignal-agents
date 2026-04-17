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

/**
 * Supported invitation URN type prefixes.
 * LinkedIn uses several URN formats for invitation entities:
 *   - fsd_invitation  (most common, Feed-Side-Data namespace)
 *   - fs_relInvitation (Relationships namespace, seen in newer API responses)
 *   - invitation       (plain, legacy format)
 *
 * Both the Strategy 2 filter and parseInvitationEntity derive from this list
 * so adding a new prefix automatically propagates everywhere.
 */
export const INVITATION_URN_PREFIXES = ["fsd_invitation", "fs_relInvitation", "invitation"] as const;

/**
 * Regex to extract the numeric invitation ID from any supported URN format.
 * Matches: urn:li:fsd_invitation:12345, urn:li:fs_relInvitation:67890, urn:li:invitation:11111
 */
export const INVITATION_URN_RE = new RegExp(`(?:${INVITATION_URN_PREFIXES.join("|")}):(\\d+)`);

/**
 * Extract the numeric invitation ID from an entity URN string.
 * Returns null if the URN doesn't match any known invitation format.
 */
export function parseInvitationId(entityUrn: string): string | null {
  const match = entityUrn.match(INVITATION_URN_RE);
  return match?.[1] ?? null;
}

// NOTE: This ConnectionStatus matches worker/src/linkedin-browser.ts, NOT
// src/lib/linkedin/types.ts. The shared server type uses different values
// (none/failed/expired). VoyagerClient only runs in the worker context.
export type ConnectionStatus =
  | "connected"
  | "pending"
  | "not_connected"
  | "not_connectable"
  | "unknown";

export interface ConnectionCheckResult {
  status: ConnectionStatus;
  shouldBrowserFallback?: boolean;
}

interface MemberResolutionResult {
  ok: boolean;
  profileId?: string;
  memberId?: string;
  reason?: "invalid_profile_url" | "checkpoint_detected" | "urn_not_found";
  responseUrl?: string;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface SentInvitation {
  entityUrn: string;      // urn:li:fsd_invitation:123456, urn:li:fs_relInvitation:67890, or urn:li:invitation:11111
  invitationId: string;   // numeric part extracted from any supported URN format
  sharedSecret: string;
  toMemberId: string;     // target member URN or ID
  sentTime: number;       // epoch ms
}

export interface VoyagerConversation {
  entityUrn: string;                       // LinkedIn's full entityUrn for the conversation
  conversationId: string;                  // Extracted ID portion (after last colon in entityUrn)
  participantName: string | null;          // Display name of the other participant
  participantUrn: string | null;           // URN of the other participant
  participantProfileUrl: string | null;    // LinkedIn profile URL (e.g. /in/john-doe)
  participantHeadline: string | null;      // Professional headline
  participantProfilePicUrl: string | null; // Profile picture URL
  lastActivityAt: number;                  // Epoch ms from lastActivityAt
  unreadCount: number;                     // Number of unread messages
  lastMessageSnippet: string | null;       // Preview text of the last message
  embeddedMessages?: VoyagerMessage[];     // Messages embedded in GraphQL conversation response
}

export interface VoyagerMessage {
  eventUrn: string;          // LinkedIn's event entityUrn (unique ID)
  senderUrn: string;         // Who sent this message (URN)
  senderName: string | null; // Display name if available
  body: string;              // Message text content
  deliveredAt: number;       // Epoch ms timestamp
}

function randomDelay(minMs: number = 2000, maxMs: number = 3000): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  private selfUrn: string | null = null;

  private truncateDiagnostic(value: string, maxLength: number = 500): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  constructor(liAt: string, jsessionId: string, proxyUrl?: string) {
    this.liAt = liAt;
    // Normalize JSESSIONID — strip surrounding quotes if present.
    // Browser CDP may return "ajax:1234" (with quotes) or ajax:1234 (without).
    // We store the unquoted value and add quotes in the Cookie header.
    const cleanJsession = jsessionId.replace(/^"|"$/g, "");
    this.jsessionId = cleanJsession;
    this.csrfToken = cleanJsession;

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

    // Contextual Referer based on endpoint
    let referer = "https://www.linkedin.com/";
    if (path.includes("/feed/")) referer = "https://www.linkedin.com/feed/";
    else if (path.includes("/messaging") || path.includes("Messaging")) referer = "https://www.linkedin.com/messaging/";
    else if (path.includes("/me") || path.includes("/identity/")) referer = "https://www.linkedin.com/feed/";

    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
      Accept: "application/vnd.linkedin.normalized+json+2.1",
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "en-US,en;q=0.9",
      "csrf-token": this.csrfToken,
      "x-restli-protocol-version": "2.0.0",
      "x-li-lang": "en_US",
      "x-li-track": JSON.stringify({
        clientVersion: "1.13.9876",
        mpVersion: "0.338.123",
        osName: "web",
        timezoneOffset: 0,
        deviceFormFactor: "DESKTOP",
        mpName: "voyager-web",
      }),
      Referer: referer,
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
   *
   * Returns:
   *   "ok"             — session is valid
   *   "expired"        — 401/403 (genuine auth failure)
   *   "rate_limited"   — 429 (session may be fine, back off)
   *   "checkpoint"     — account under verification
   *   "network_error"  — transient failure (don't mark expired)
   */
  async testSession(): Promise<"ok" | "expired" | "rate_limited" | "checkpoint" | "network_error"> {
    try {
      const response = await this.request("/me");
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        console.log("[VoyagerClient] testSession: checkpoint/challenge redirect detected");
        return "checkpoint";
      }
      return "ok";
    } catch (err) {
      if (err instanceof VoyagerError) {
        console.log(`[VoyagerClient] testSession failed: HTTP ${err.status} — ${err.body.slice(0, 200)}`);
        if (err.status === 401 || err.status === 403) return "expired";
        if (err.status === 429) return "rate_limited";
        // Other HTTP errors (5xx, etc.) — treat as transient
        return "network_error";
      }
      // Non-HTTP errors (DNS, timeout, connection refused)
      console.log(`[VoyagerClient] testSession network error: ${err instanceof Error ? err.message : String(err)}`);
      return "network_error";
    }
  }

  // ─── Keepalive methods ─────────────────────────────────────────────────────
  // Lightweight read-only calls that mimic natural browsing patterns.
  // Each returns true on success, false on auth failure (session dead).

  async keepaliveFetchProfile(): Promise<boolean> {
    try {
      await this.request("/me");
      return true;
    } catch (err) {
      if (err instanceof VoyagerError && (err.status === 401 || err.status === 403)) return false;
      return true; // network errors don't mean session is dead
    }
  }

  async keepaliveFetchNotifications(): Promise<boolean> {
    try {
      await this.request("/voyagerNotificationsDashNotificationCards?count=1&offset=0");
      return true;
    } catch (err) {
      if (err instanceof VoyagerError && (err.status === 401 || err.status === 403)) return false;
      return true;
    }
  }

  async keepaliveFetchMessaging(): Promise<boolean> {
    try {
      // Use GraphQL endpoint for keepalive — the old DashMessenger REST endpoint returns 400
      const selfUrn = await this.getSelfUrn();
      if (!selfUrn) return true; // Can't get URN but session might still be alive
      const mailboxUrn = encodeURIComponent(selfUrn);
      await this.request(
        `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=(mailboxUrn:${mailboxUrn})`,
        { extraHeaders: { Accept: "application/graphql" } }
      );
      return true;
    } catch (err) {
      if (err instanceof VoyagerError && (err.status === 401 || err.status === 403)) return false;
      return true;
    }
  }

  async keepaliveFetchFeed(): Promise<boolean> {
    try {
      await this.request("/feed/normUpdate?count=1&q=FEED_UPDATES");
      return true;
    } catch (err) {
      if (err instanceof VoyagerError && (err.status === 401 || err.status === 403)) return false;
      return true;
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

  private async resolveMemberId(
    profileUrl: string,
  ): Promise<MemberResolutionResult> {
    const profileId = this.extractProfileId(profileUrl);
    if (!profileId) {
      return { ok: false, reason: "invalid_profile_url" };
    }

    const response = await this.request(
      `/identity/dash/profiles?q=memberIdentity&memberIdentity=${profileId}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-6`,
    );

    if (
      response.url.includes("/checkpoint/") ||
      response.url.includes("/challenge/")
    ) {
      return {
        ok: false,
        reason: "checkpoint_detected",
        profileId,
        responseUrl: response.url,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;
    const elements = (data as Record<string, unknown[]>).data
      ? ((data as Record<string, Record<string, unknown[]>>).data?.[
          "*elements"
        ] ?? [])
      : [];

    const entityUrn = (elements[0] as string) ?? null;
    if (!entityUrn) {
      return { ok: false, reason: "urn_not_found", profileId };
    }

    return {
      ok: true,
      profileId,
      memberId: entityUrn.replace("urn:li:fsd_profile:", ""),
      responseUrl: response.url,
    };
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
      const resolved = await this.resolveMemberId(profileUrl);
      if (!resolved.ok) {
        if (resolved.reason === "invalid_profile_url") {
          return { success: false, error: "invalid_profile_url" };
        }
        if (resolved.reason === "checkpoint_detected") {
          return {
            success: false,
            error: "checkpoint_detected",
            details: { retry: false },
          };
        }
        return {
          success: false,
          error: "urn_not_found",
          details: { profileId: resolved.profileId ?? null },
        };
      }
      if (!resolved.memberId || !resolved.profileId) {
        return {
          success: false,
          error: "urn_not_found",
          details: { profileId: resolved.profileId ?? null },
        };
      }
      return {
        success: true,
        details: { memberUrn: resolved.memberId, profileId: resolved.profileId },
      };
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
        console.warn(
          `[VoyagerClient] sendConnectionRequest: resolveMemberId failed for ${profileUrl}: error=${profileResult.error}`,
        );
        return profileResult;
      }

      const memberUrn = profileResult.details?.memberUrn as string;
      const profileId = profileResult.details?.profileId as string;
      console.log(
        `[VoyagerClient] sendConnectionRequest: resolved ${profileUrl} → member=${memberUrn}`,
      );

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
        console.warn(
          `[VoyagerClient] sendConnectionRequest: checkpoint redirect for ${profileUrl}: url=${response.url}`,
        );
        return {
          success: false,
          error: "checkpoint_detected",
          details: { retry: false },
        };
      }

      console.log(
        `[VoyagerClient] sendConnectionRequest: success for ${profileUrl} → member=${memberUrn}`,
      );
      return { success: true, details: { memberUrn } };
    } catch (err) {
      // CANT_RESEND_YET = already sent an invite to this person
      if (err instanceof VoyagerError && err.status === 400) {
        console.warn(
          `[VoyagerClient] sendConnectionRequest: already_invited for ${profileUrl}: status=400 body=${this.truncateDiagnostic(err.body)}`,
        );
        return { success: false, error: "already_invited" };
      }
      if (err instanceof VoyagerError) {
        console.warn(
          `[VoyagerClient] sendConnectionRequest: POST failed for ${profileUrl}: status=${err.status} body=${this.truncateDiagnostic(err.body)}`,
        );
      } else {
        console.warn(
          `[VoyagerClient] sendConnectionRequest: threw for ${profileUrl}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return this.handleError(err);
    }
  }

  /**
   * Generate a random 16-byte tracking ID for messaging requests.
   */
  private generateTrackingId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return String.fromCharCode(...bytes);
  }

  /**
   * Fetch the authenticated user's own fsd_profile URN.
   * Cached after first call so /me is only hit once per instance.
   */
  private async getSelfUrn(): Promise<string | null> {
    if (this.selfUrn) return this.selfUrn;

    try {
      const res = await this.request("/me");
      const data = (await res.json()) as Record<string, unknown>;

      // Try included[].dashEntityUrn (normalized response format)
      const included = data?.included as Array<Record<string, unknown>> | undefined;
      if (included) {
        for (const item of included) {
          const dash = item.dashEntityUrn as string | undefined;
          if (dash?.startsWith("urn:li:fsd_profile:")) {
            this.selfUrn = dash;
            return dash;
          }
        }
      }

      // Try data.*miniProfile → extract ID → construct fsd_profile URN
      const innerData = data?.data as Record<string, unknown> | undefined;
      const miniProfileUrn = innerData?.["*miniProfile"] as string | undefined;
      if (miniProfileUrn) {
        const id = miniProfileUrn.split(":").pop();
        if (id) {
          this.selfUrn = `urn:li:fsd_profile:${id}`;
          return this.selfUrn;
        }
      }

      console.error(
        "[VoyagerClient] Could not extract selfUrn from /me response:",
        JSON.stringify(data).substring(0, 500)
      );
      return null;
    } catch (err) {
      console.error("[VoyagerClient] Failed to fetch /me:", err);
      return null;
    }
  }

  /**
   * Fetch the logged-in user's own LinkedIn profile URL via the /me endpoint.
   *
   * Extracts publicIdentifier from the miniProfile in the /me response and
   * constructs the canonical profile URL. Used for backfilling linkedinProfileUrl
   * on senders that logged in before profile URL extraction was added.
   *
   * Returns null if extraction fails (does not throw).
   */
  async fetchOwnProfileUrl(): Promise<string | null> {
    try {
      const res = await this.request("/me");
      const data = (await res.json()) as Record<string, unknown>;

      // Check included[] for miniProfile with publicIdentifier
      const included = data?.included as Array<Record<string, unknown>> | undefined;
      if (included) {
        for (const item of included) {
          const publicId = item.publicIdentifier as string | undefined;
          if (publicId && typeof publicId === "string" && publicId.length > 0) {
            const url = `https://www.linkedin.com/in/${publicId}`;
            console.log(`[VoyagerClient] Own profile URL: ${url}`);
            return url;
          }
        }
      }

      // Fallback: check data.miniProfile or data.publicIdentifier
      const innerData = data?.data as Record<string, unknown> | undefined;
      const publicId = innerData?.publicIdentifier as string | undefined;
      if (publicId && typeof publicId === "string" && publicId.length > 0) {
        const url = `https://www.linkedin.com/in/${publicId}`;
        console.log(`[VoyagerClient] Own profile URL (from data): ${url}`);
        return url;
      }

      console.warn(
        "[VoyagerClient] Could not extract publicIdentifier from /me response:",
        JSON.stringify(data).substring(0, 500)
      );
      return null;
    } catch (err) {
      console.error("[VoyagerClient] Failed to fetch own profile URL:", err);
      return null;
    }
  }

  /**
   * Send a message to an existing 1st-degree LinkedIn connection.
   *
   * Uses the dash messaging endpoint (voyagerMessagingDashMessengerMessages).
   * Only works for connected profiles.
   */
  async sendMessage(
    profileUrl: string,
    message: string
  ): Promise<ActionResult> {
    // Step 1: View profile to get recipient's memberUrn
    const profileResult = await this.viewProfile(profileUrl);
    if (!profileResult.success || !profileResult.details?.memberUrn) {
      return {
        success: false,
        error: "Failed to resolve profile",
        details: profileResult.details,
      };
    }

    const memberUrn = profileResult.details.memberUrn as string;

    // Step 2: Get sender's own URN for mailboxUrn
    const selfUrn = await this.getSelfUrn();
    if (!selfUrn) {
      return { success: false, error: "Failed to resolve sender profile URN" };
    }

    // Step 3: Send message via new dash endpoint
    const recipientUrn = `urn:li:fsd_profile:${memberUrn}`;
    const body = {
      dedupeByClientGeneratedToken: false,
      hostRecipientUrns: [recipientUrn],
      mailboxUrn: selfUrn,
      message: {
        body: { attributes: [], text: message },
        originToken: crypto.randomUUID(),
        renderContentUnions: [],
      },
      trackingId: this.generateTrackingId(),
    };

    try {
      await this.request(
        "/voyagerMessagingDashMessengerMessages?action=createMessage",
        {
          method: "POST",
          body: JSON.stringify(body),
          extraHeaders: {
            "Content-Type": "application/json",
          },
        }
      );

      return { success: true, details: { memberUrn, recipientUrn } };
    } catch (err) {
      return this.handleError(err);
    }
  }

  /**
   * Check the connection status with a LinkedIn profile.
   *
   * Extracts profileId from URL, GETs /identity/profiles/{id}/relationships,
   * and parses distanceOfConnection from the response.
   */
  async checkConnectionStatusDetailed(
    profileUrl: string,
  ): Promise<ConnectionCheckResult> {
    try {
      const resolved = await this.resolveMemberId(profileUrl);
      if (!resolved.ok) {
        if (resolved.reason === "invalid_profile_url") {
          console.warn(
            `[VoyagerClient] checkConnectionStatus: failed to extract profileId from ${profileUrl}`,
          );
        } else if (resolved.reason === "checkpoint_detected") {
          console.warn(
            `[VoyagerClient] checkConnectionStatus checkpoint on profile resolve for ${resolved.profileId}: url=${resolved.responseUrl}`,
          );
        } else if (resolved.reason === "urn_not_found") {
          console.warn(
            `[VoyagerClient] checkConnectionStatus: could not resolve member ID for ${resolved.profileId}`,
          );
        }
        return { status: "unknown" };
      }

      if (!resolved.memberId || !resolved.profileId) {
        console.warn(
          `[VoyagerClient] checkConnectionStatus: incomplete member resolution for ${profileUrl}`,
        );
        return { status: "unknown" };
      }

      const response = await this.request(
        `/identity/profiles/${resolved.memberId}/relationships`
      );

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        console.warn(
          `[VoyagerClient] checkConnectionStatus checkpoint redirect for ${resolved.profileId} (member ${resolved.memberId}): status=${response.status} url=${response.url}`,
        );
        return { status: "unknown" };
      }

      const rawBody = await response.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(rawBody) as Record<string, unknown>;
      } catch (err) {
        console.warn(
          `[VoyagerClient] checkConnectionStatus invalid JSON for ${resolved.profileId} (member ${resolved.memberId}): status=${response.status} url=${response.url} body=${this.truncateDiagnostic(rawBody)}`,
        );
        throw err;
      }

      // Parse memberRelationship.distanceOfConnection
      const memberRelationship = data.memberRelationship as
        | Record<string, unknown>
        | undefined;
      const distance = memberRelationship?.distanceOfConnection as
        | string
        | undefined;

      if (distance === "DISTANCE_1") {
        return { status: "connected" };
      }

      if (distance === "DISTANCE_2" || distance === "DISTANCE_3") {
        // Check for pending invitation
        const invitation = memberRelationship?.invitation;
        return { status: invitation ? "pending" : "not_connected" };
      }

      console.warn(
        `[VoyagerClient] checkConnectionStatus unknown relationship shape for ${resolved.profileId} (member ${resolved.memberId}): status=${response.status} url=${response.url} body=${this.truncateDiagnostic(rawBody)}`,
      );
      return { status: "unknown" };
    } catch (err) {
      if (err instanceof VoyagerError) {
        console.warn(
          `[VoyagerClient] checkConnectionStatus request failed for ${profileUrl}: status=${err.status} body=${this.truncateDiagnostic(err.body)}`,
        );
        if (err.status === 404) {
          return { status: "unknown", shouldBrowserFallback: true };
        }
      } else if (err instanceof Error) {
        console.warn(
          `[VoyagerClient] checkConnectionStatus threw for ${profileUrl}: ${err.message}`,
        );
      } else {
        console.warn(
          `[VoyagerClient] checkConnectionStatus threw for ${profileUrl}: ${String(err)}`,
        );
      }
      return { status: "unknown" };
    }
  }

  async checkConnectionStatus(profileUrl: string): Promise<ConnectionStatus> {
    const result = await this.checkConnectionStatusDetailed(profileUrl);
    return result.status;
  }

  /**
   * Fetch the last N LinkedIn messaging conversations for the authenticated user.
   *
   * LinkedIn migrated conversations to a GraphQL endpoint in early 2026.
   * This method uses the new GraphQL endpoint as primary, with the old
   * DashMessenger REST endpoint as a fallback for edge cases.
   *
   * Tier 1 (primary): GraphQL messengerConversations — requires sender's fsd_profile URN
   * Tier 2 (fallback): DashMessenger REST — may still work for some accounts
   */
  async fetchConversations(limit: number = 20): Promise<VoyagerConversation[]> {
    try {
      // Resolve sender's own URN for the mailboxUrn parameter
      const selfUrn = await this.getSelfUrn();

      // Tier 1: GraphQL messengerConversations (primary — LinkedIn migrated to this in 2026)
      if (selfUrn) {
        try {
          const mailboxUrn = encodeURIComponent(selfUrn);
          const response = await this.request(
            `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=(mailboxUrn:${mailboxUrn})`,
            { extraHeaders: { Accept: "application/graphql" } }
          );

          // Checkpoint detection
          if (
            response.url.includes("/checkpoint/") ||
            response.url.includes("/challenge/")
          ) {
            throw new VoyagerError(403, "checkpoint_detected");
          }

          const data = (await response.json()) as Record<string, unknown>;

          const conversations = this.parseGraphQLConversations(data, selfUrn);
          console.log(
            `[VoyagerClient] GraphQL parsed ${conversations.length} conversations`
          );
          return conversations;
        } catch (err) {
          if (err instanceof VoyagerError && err.status === 403) throw err; // checkpoint — don't retry
          // For other errors (400, 404, 500, network) fall through to tier 2
          console.warn(
            `[VoyagerClient] GraphQL conversations endpoint failed (${err instanceof VoyagerError ? err.status : "network"}), falling back to DashMessenger REST...`
          );
        }
      } else {
        console.warn("[VoyagerClient] Could not resolve selfUrn — skipping GraphQL tier, trying REST fallback");
      }

      // Tier 2: DashMessenger REST (fallback)
      console.log("[VoyagerClient] Trying DashMessenger REST endpoint...");
      const restResponse = await this.request(
        `/voyagerMessagingDashMessengerConversations?count=${limit}`
      );

      // Checkpoint detection
      if (
        restResponse.url.includes("/checkpoint/") ||
        restResponse.url.includes("/challenge/")
      ) {
        throw new VoyagerError(403, "checkpoint_detected");
      }

      const restData = (await restResponse.json()) as Record<string, unknown>;

      console.log(
        "[VoyagerClient] fetchConversations REST raw (first 3000 chars):",
        JSON.stringify(restData).slice(0, 3000)
      );

      return this.parseConversations(restData);
    } catch (err) {
      if (err instanceof VoyagerError) throw err;
      throw new VoyagerError(0, String(err));
    }
  }

  /**
   * Parse the GraphQL messengerConversations response into VoyagerConversation objects.
   *
   * LinkedIn's GraphQL response shape (as of 2026):
   *   data.messengerConversationsBySyncToken.elements[]
   *
   * Each element has inline participant objects (conversationParticipants[]),
   * and the most recent message is in messages.elements[0].
   *
   * selfUrn is used to identify which participant is the sender (SELF) so we
   * can extract the other participant's info.
   */
  private parseGraphQLConversations(
    data: Record<string, unknown>,
    selfUrn: string
  ): VoyagerConversation[] {
    try {
      // Navigate to elements array
      const dataInner = data.data as Record<string, unknown> | undefined;
      const syncData = dataInner?.messengerConversationsBySyncToken as
        | Record<string, unknown>
        | undefined;
      const elements = syncData?.elements as Array<Record<string, unknown>> | undefined;

      if (!Array.isArray(elements)) {
        console.warn(
          "[VoyagerClient] parseGraphQLConversations: no elements array found in response"
        );
        return [];
      }

      return elements
        .map((conv): VoyagerConversation | null => {
          // entityUrn e.g. "urn:li:msg_conversation:(urn:li:fsd_profile:ACoAAA...,2-base64==)"
          const entityUrn = conv.entityUrn as string | undefined;
          if (!entityUrn) return null;

          // conversationId — extract from backendUrn: "urn:li:messagingThread:2-base64=="
          const backendUrn = conv.backendUrn as string | undefined;
          const conversationId = backendUrn
            ? backendUrn.replace("urn:li:messagingThread:", "")
            : entityUrn.split(":").pop() ?? entityUrn;

          const lastActivityAt = (conv.lastActivityAt as number | undefined) ?? 0;
          const unreadCount = (conv.unreadCount as number | undefined) ?? 0;

          // Find the non-self participant (distance !== "SELF")
          const participants = conv.conversationParticipants as
            | Array<Record<string, unknown>>
            | undefined;

          let participantName: string | null = null;
          let participantUrn: string | null = null;
          let participantProfileUrl: string | null = null;
          let participantHeadline: string | null = null;
          let participantProfilePicUrl: string | null = null;

          if (Array.isArray(participants)) {
            for (const p of participants) {
              const pType = p.participantType as Record<string, unknown> | undefined;
              const member = pType?.member as Record<string, unknown> | undefined;
              if (!member) continue;

              // Identify non-self participant by distance
              const distance = member.distance as string | undefined;
              if (distance === "SELF") continue;

              // Also skip if this participant's backendUrn matches our selfUrn member ID
              // (guard for accounts where distance might not be set correctly)
              const pBackendUrn = p.backendUrn as string | undefined;
              const selfMemberId = selfUrn.replace("urn:li:fsd_profile:", "urn:li:member:");
              if (pBackendUrn && pBackendUrn === selfMemberId) continue;

              participantUrn = (p.entityUrn as string | undefined) ?? null;

              const firstName = (member.firstName as Record<string, unknown> | undefined)?.text as string | undefined;
              const lastName = (member.lastName as Record<string, unknown> | undefined)?.text as string | undefined;
              if (firstName || lastName) {
                participantName = `${firstName ?? ""} ${lastName ?? ""}`.trim();
              }

              // profileUrl — prefer publicIdentifier (vanity slug), fall back to profileUrl
              const publicId = member.publicIdentifier as string | undefined;
              if (publicId) {
                participantProfileUrl = `/in/${publicId}`;
              } else {
                const rawProfileUrl = member.profileUrl as string | undefined;
                if (rawProfileUrl) {
                  const inMatch = rawProfileUrl.match(/linkedin\.com(\/in\/[^/?#]+)/);
                  participantProfileUrl = inMatch ? inMatch[1] : rawProfileUrl;
                }
              }

              participantHeadline =
                (member.headline as Record<string, unknown> | undefined)?.text as string ?? null;

              // Profile picture — rootUrl + largest artifact
              const pic = member.profilePicture as Record<string, unknown> | undefined;
              if (pic) {
                const rootUrl = pic.rootUrl as string | undefined;
                const artifacts = pic.artifacts as Array<Record<string, unknown>> | undefined;
                if (rootUrl && artifacts && artifacts.length > 0) {
                  // Pick largest artifact (last by index, as they're ordered smallest→largest)
                  const largest = artifacts[artifacts.length - 1];
                  const segment = largest.fileIdentifyingUrlPathSegment as string | undefined;
                  if (segment) participantProfilePicUrl = rootUrl + segment;
                }
              }

              break; // Found the non-self participant
            }
          }

          // Last message snippet — messages.elements[0] is the most recent message
          let lastMessageSnippet: string | null = null;
          const messages = conv.messages as Record<string, unknown> | undefined;
          const messageElements = messages?.elements as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(messageElements) && messageElements.length > 0) {
            const lastMsg = messageElements[0];
            const body = lastMsg.body as Record<string, unknown> | undefined;
            lastMessageSnippet = (body?.text as string | undefined) ?? null;
          }

          // Parse all embedded messages from the GraphQL conversation response
          // so we can skip the separate fetchMessages() call (which returns 400).
          const embeddedMessages: VoyagerMessage[] = [];
          if (Array.isArray(messageElements)) {
            // Build a participant name lookup from conversationParticipants
            const participantNameMap = new Map<string, string>();
            if (Array.isArray(participants)) {
              for (const p of participants) {
                const pUrn = p.entityUrn as string | undefined;
                const pBackendUrn = p.backendUrn as string | undefined;
                const pType = p.participantType as Record<string, unknown> | undefined;
                const member = pType?.member as Record<string, unknown> | undefined;
                if (!member) continue;
                const firstName = (member.firstName as Record<string, unknown> | undefined)?.text as string | undefined;
                const lastName = (member.lastName as Record<string, unknown> | undefined)?.text as string | undefined;
                const name = `${firstName ?? ""} ${lastName ?? ""}`.trim() || null;
                if (name) {
                  if (pUrn) participantNameMap.set(pUrn, name);
                  if (pBackendUrn) participantNameMap.set(pBackendUrn, name);
                }
              }
            }

            for (const msgEl of messageElements) {
              const msgUrn = (msgEl.entityUrn as string | undefined) ?? null;
              if (!msgUrn) continue;

              // Sender identification — check sender.participantType.member, sender.entityUrn, actor
              let msgSenderUrn = "";
              let msgSenderName: string | null = null;

              const senderObj = msgEl.sender as Record<string, unknown> | undefined;
              if (senderObj) {
                // sender may have entityUrn directly
                msgSenderUrn = (senderObj.entityUrn as string | undefined) ?? "";
                // sender may have participantType.member for name
                const senderPType = senderObj.participantType as Record<string, unknown> | undefined;
                const senderMember = senderPType?.member as Record<string, unknown> | undefined;
                if (senderMember) {
                  const sFirstName = (senderMember.firstName as Record<string, unknown> | undefined)?.text as string | undefined;
                  const sLastName = (senderMember.lastName as Record<string, unknown> | undefined)?.text as string | undefined;
                  msgSenderName = `${sFirstName ?? ""} ${sLastName ?? ""}`.trim() || null;
                }
                // Also check sender.name directly
                if (!msgSenderName) {
                  msgSenderName = (senderObj.name as string | undefined) ?? null;
                }
                // Try backendUrn for name lookup
                const senderBackendUrn = senderObj.backendUrn as string | undefined;
                if (!msgSenderName && senderBackendUrn) {
                  msgSenderName = participantNameMap.get(senderBackendUrn) ?? null;
                }
              }

              // Fallback: actor field
              if (!msgSenderUrn) {
                msgSenderUrn = (msgEl.actor as string | undefined) ?? (msgEl.from as string | undefined) ?? "";
              }

              // Resolve sender name from participant map if not yet found
              if (!msgSenderName && msgSenderUrn) {
                msgSenderName = participantNameMap.get(msgSenderUrn) ?? null;
              }

              // Message body
              const msgBodyObj = msgEl.body as Record<string, unknown> | string | undefined;
              let msgBodyText = "";
              if (typeof msgBodyObj === "string") {
                msgBodyText = msgBodyObj;
              } else if (msgBodyObj && typeof msgBodyObj === "object") {
                msgBodyText = (msgBodyObj.text as string | undefined) ?? "";
              }

              // Extract URLs from attachments / renderContent (embedded messages)
              try {
                // Check renderContent (GraphQL embedded messages) and renderContentUnions
                const msgRcSources = [
                  msgEl.renderContent as Array<Record<string, unknown>> | undefined,
                  msgEl.renderContentUnions as Array<Record<string, unknown>> | undefined,
                ];
                const urls: string[] = [];
                for (const msgRcu of msgRcSources) {
                  if (!msgRcu) continue;
                  for (const rcu of msgRcu) {
                    const extMedia = rcu.externalMedia as Record<string, unknown> | undefined;
                    if (extMedia?.url) urls.push(extMedia.url as string);
                    const article = rcu.article as Record<string, unknown> | undefined;
                    if (article?.url) urls.push(article.url as string);
                    // File attachments — include name
                    const file = rcu.file as Record<string, unknown> | undefined;
                    if (file?.name) urls.push(`[${file.name}]`);
                  }
                }
                // Fallback: renderContentFallbackText often contains the URL as plain text
                if (urls.length === 0) {
                  const fallback = msgEl.renderContentFallbackText as string | undefined;
                  if (fallback) {
                    const urlMatches = fallback.match(/https?:\/\/[^\s]+/g);
                    if (urlMatches) urls.push(...urlMatches);
                    else if (fallback.trim()) urls.push(fallback.trim());
                  }
                }
                if (urls.length > 0) {
                  msgBodyText = msgBodyText ? `${msgBodyText}\n${urls.join("\n")}` : urls.join("\n");
                }
              } catch {
                // Best-effort
              }

              // Timestamp
              const msgDeliveredAt =
                (msgEl.deliveredAt as number | undefined) ??
                (msgEl.createdAt as number | undefined) ??
                0;

              embeddedMessages.push({
                eventUrn: msgUrn,
                senderUrn: msgSenderUrn,
                senderName: msgSenderName,
                body: msgBodyText,
                deliveredAt: msgDeliveredAt,
              });
            }
          }

          return {
            entityUrn,
            conversationId,
            participantName,
            participantUrn,
            participantProfileUrl,
            participantHeadline,
            participantProfilePicUrl,
            lastActivityAt,
            unreadCount,
            lastMessageSnippet,
            ...(embeddedMessages.length > 0 ? { embeddedMessages } : {}),
          };
        })
        .filter((c): c is VoyagerConversation => c !== null);
    } catch (err) {
      console.error("[VoyagerClient] parseGraphQLConversations error:", err);
      return [];
    }
  }

  /**
   * Fetch the last N messages for a given conversation ID.
   *
   * Applies a 2-3s random delay before the API call to mimic human browsing.
   * On 404 from primary endpoint, falls back to the legacy messaging endpoint.
   * Parsing is defensive — returns empty array on unexpected response shapes.
   */
  async fetchMessages(
    conversationId: string,
    count: number = 20,
    entityUrn?: string
  ): Promise<VoyagerMessage[]> {
    // 2-3s random delay before each Voyager API call (account safety)
    await randomDelay();

    try {
      let response: Response;
      try {
        response = await this.request(
          `/voyagerMessagingDashMessengerMessages?conversationUrn=${encodeURIComponent(
            "urn:li:messagingThread:" + conversationId
          )}&count=${count}`
        );
      } catch (err) {
        // On 400/404, try the legacy endpoint
        if (err instanceof VoyagerError && (err.status === 400 || err.status === 404)) {
          try {
            response = await this.request(
              `/messaging/conversations/${conversationId}/events?count=${count}`
            );
          } catch (legacyErr) {
            // Legacy also failed — try GraphQL if we have the full entity URN
            if (entityUrn) {
              return await this.fetchMessagesGraphQL(entityUrn, count);
            }
            throw legacyErr;
          }
        } else {
          throw err;
        }
      }

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        throw new VoyagerError(403, "checkpoint_detected");
      }

      const data = (await response.json()) as Record<string, unknown>;

      return this.parseMessages(data);
    } catch (err) {
      if (err instanceof VoyagerError) throw err;
      throw new VoyagerError(0, String(err));
    }
  }

  /**
   * Fetch messages for a conversation using the GraphQL messaging endpoint.
   *
   * Requires the full conversation entity URN (e.g.
   * "urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-YYY==)").
   * Used as a third-tier fallback when both REST endpoints return 400/404.
   */
  async fetchMessagesGraphQL(
    conversationEntityUrn: string,
    count: number = 20
  ): Promise<VoyagerMessage[]> {
    await randomDelay();

    try {
      const response = await this.request(
        `/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.d8ea76885a52fd5dc5c317078ab7c977&variables=(deliveredAt:${Date.now()},conversationUrn:${encodeURIComponent(conversationEntityUrn)},countBefore:${count},countAfter:0)`,
        { extraHeaders: { Accept: "application/graphql" } }
      );

      // Checkpoint detection
      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        throw new VoyagerError(403, "checkpoint_detected");
      }

      const rawData = (await response.json()) as Record<string, unknown>;

      // Parse GraphQL response: data.messengerMessagesByAnchorTimestamp.elements[]
      const dataObj = rawData.data as Record<string, unknown> | undefined;
      const messagesContainer = dataObj?.messengerMessagesByAnchorTimestamp as Record<string, unknown> | undefined;
      const elements = messagesContainer?.elements as Array<Record<string, unknown>> | undefined;

      if (!elements || elements.length === 0) {
        return [];
      }

      console.log(`[VoyagerClient] fetchMessagesGraphQL: found ${elements.length} message elements`);

      // Parse each element using the same approach as embedded messages
      const messages: VoyagerMessage[] = [];
      for (const msgEl of elements) {
        const msgUrn = (msgEl.entityUrn as string | undefined) ?? null;
        if (!msgUrn) continue;

        // Sender identification
        let msgSenderUrn = "";
        let msgSenderName: string | null = null;

        const senderObj = msgEl.sender as Record<string, unknown> | undefined;
        if (senderObj) {
          msgSenderUrn = (senderObj.entityUrn as string | undefined) ?? "";
          const senderPType = senderObj.participantType as Record<string, unknown> | undefined;
          const senderMember = senderPType?.member as Record<string, unknown> | undefined;
          if (senderMember) {
            const sFirstName = (senderMember.firstName as Record<string, unknown> | undefined)?.text as string | undefined;
            const sLastName = (senderMember.lastName as Record<string, unknown> | undefined)?.text as string | undefined;
            msgSenderName = `${sFirstName ?? ""} ${sLastName ?? ""}`.trim() || null;
          }
          if (!msgSenderName) {
            msgSenderName = (senderObj.name as string | undefined) ?? null;
          }
          const senderBackendUrn = senderObj.backendUrn as string | undefined;
          if (!msgSenderName && senderBackendUrn) {
            msgSenderName = null; // No participant map available in this context
          }
        }

        // Fallback: actor field
        if (!msgSenderUrn) {
          msgSenderUrn = (msgEl.actor as string | undefined) ?? (msgEl.from as string | undefined) ?? "";
        }

        // Message body
        const msgBodyObj = msgEl.body as Record<string, unknown> | string | undefined;
        let msgBodyText = "";
        if (typeof msgBodyObj === "string") {
          msgBodyText = msgBodyObj;
        } else if (msgBodyObj && typeof msgBodyObj === "object") {
          msgBodyText = (msgBodyObj.text as string | undefined) ?? "";
        }

        // Extract URLs from renderContent / renderContentUnions
        try {
          const msgRcSources = [
            msgEl.renderContent as Array<Record<string, unknown>> | undefined,
            msgEl.renderContentUnions as Array<Record<string, unknown>> | undefined,
          ];
          const urls: string[] = [];
          for (const msgRcu of msgRcSources) {
            if (!msgRcu) continue;
            for (const rcu of msgRcu) {
              const extMedia = rcu.externalMedia as Record<string, unknown> | undefined;
              if (extMedia?.url) urls.push(extMedia.url as string);
              const article = rcu.article as Record<string, unknown> | undefined;
              if (article?.url) urls.push(article.url as string);
              const file = rcu.file as Record<string, unknown> | undefined;
              if (file?.name) urls.push(`[${file.name}]`);
            }
          }
          if (urls.length === 0) {
            const fallback = msgEl.renderContentFallbackText as string | undefined;
            if (fallback) {
              const urlMatches = fallback.match(/https?:\/\/[^\s]+/g);
              if (urlMatches) urls.push(...urlMatches);
              else if (fallback.trim()) urls.push(fallback.trim());
            }
          }
          if (urls.length > 0) {
            msgBodyText = msgBodyText ? `${msgBodyText}\n${urls.join("\n")}` : urls.join("\n");
          }
        } catch {
          // Best-effort
        }

        // Timestamp
        const msgDeliveredAt =
          (msgEl.deliveredAt as number | undefined) ??
          (msgEl.createdAt as number | undefined) ??
          0;

        messages.push({
          eventUrn: msgUrn,
          senderUrn: msgSenderUrn,
          senderName: msgSenderName,
          body: msgBodyText,
          deliveredAt: msgDeliveredAt,
        });
      }

      return messages;
    } catch (err) {
      if (err instanceof VoyagerError) throw err;
      throw new VoyagerError(0, String(err));
    }
  }

  /**
   * Parse the LinkedIn Voyager normalized REST response into VoyagerConversation objects.
   *
   * LinkedIn returns a normalized JSON format where conversations and their participant
   * entities are mixed together in an `included[]` array. This parser builds a lookup
   * map from participant URNs and then maps each conversation entity to the interface.
   *
   * Used as a fallback when the GraphQL endpoint is unavailable.
   */
  private parseConversations(
    data: Record<string, unknown>
  ): VoyagerConversation[] {
    try {
      const included = (data.included ?? []) as Array<Record<string, unknown>>;

      // Build lookup map for participant entities keyed by entityUrn
      const entityMap = new Map<string, Record<string, unknown>>();
      for (const item of included) {
        const urn = item.entityUrn as string | undefined;
        if (urn) entityMap.set(urn, item);
      }

      // Also check data.data?.elements or data.data?.["*elements"] for conversation list
      const dataInner = data.data as Record<string, unknown> | undefined;
      const elementUrns =
        (dataInner?.["*elements"] as string[] | undefined) ??
        (dataInner?.elements as string[] | undefined) ??
        [];

      // Identify conversation entities — try element URN list first, then included[]
      let conversationEntities: Array<Record<string, unknown>> = [];

      if (elementUrns.length > 0) {
        // Normalized format: elements is array of URN strings pointing into entityMap
        conversationEntities = elementUrns
          .map((urn) => entityMap.get(urn))
          .filter((e): e is Record<string, unknown> => !!e);
      } else {
        // Fallback: scan included[] for conversation-typed entities
        conversationEntities = included.filter((item) => {
          const t = item.$type as string | undefined;
          return t?.includes("MessengerConversation") || t?.includes("MessagingConversation");
        });
      }

      return conversationEntities
        .map((conv): VoyagerConversation | null => {
          const entityUrn = conv.entityUrn as string | undefined;
          if (!entityUrn) return null;

          // conversationId = last segment after colon
          const conversationId = entityUrn.split(":").pop() ?? entityUrn;

          // lastActivityAt — epoch ms
          const lastActivityAt =
            (conv.lastActivityAt as number | undefined) ?? 0;

          // unreadCount
          const unreadCount = (conv.unreadCount as number | undefined) ?? 0;

          // Last message snippet — may be in lastMessageText or nested
          const lastMessageText =
            (conv.lastMessageText as string | undefined) ?? null;

          const lastMessageSnippet =
            lastMessageText ??
            ((conv.lastMessagePreview as Record<string, unknown> | undefined)
              ?.text as string | undefined) ??
            null;

          // Participant resolution — conversations have a participants array of URNs
          // or a "participants" field with URN references
          const participantUrns: string[] = [];
          const rawParticipants = conv.participants;
          if (Array.isArray(rawParticipants)) {
            for (const p of rawParticipants) {
              if (typeof p === "string") participantUrns.push(p);
              else if (typeof p === "object" && p !== null) {
                const urn = (p as Record<string, unknown>).entityUrn as string | undefined;
                if (urn) participantUrns.push(urn);
              }
            }
          }

          // Also check *participants (normalized pointer)
          const starParticipants = conv["*participants"] as string[] | undefined;
          if (starParticipants) {
            for (const urn of starParticipants) participantUrns.push(urn);
          }

          // Find non-self participant entity — look for member/profile type
          let participantEntity: Record<string, unknown> | null = null;
          for (const urn of participantUrns) {
            const entity = entityMap.get(urn);
            if (entity) {
              const t = entity.$type as string | undefined;
              // Prefer participant entity with messaging member or mini profile info
              if (
                t?.includes("MessagingMember") ||
                t?.includes("MiniProfile") ||
                t?.includes("fsd_profile")
              ) {
                participantEntity = entity;
                break;
              }
              // Accept any non-conversation entity as fallback
              if (!t?.includes("MessengerConversation")) {
                participantEntity = entity;
              }
            }
          }

          // Extract participant fields — check nested member.miniProfile as well
          const memberEntity =
            participantEntity?.member as Record<string, unknown> | undefined;
          const miniProfile =
            (participantEntity?.miniProfile as Record<string, unknown> | undefined) ??
            (memberEntity?.miniProfile as Record<string, unknown> | undefined);

          const firstName =
            (miniProfile?.firstName as string | undefined) ??
            (participantEntity?.firstName as string | undefined);
          const lastName =
            (miniProfile?.lastName as string | undefined) ??
            (participantEntity?.lastName as string | undefined);
          const participantName =
            firstName && lastName
              ? `${firstName} ${lastName}`.trim()
              : (participantEntity?.name as string | undefined) ?? null;

          const publicIdentifier =
            (miniProfile?.publicIdentifier as string | undefined) ??
            (participantEntity?.publicIdentifier as string | undefined);
          const participantProfileUrl = publicIdentifier
            ? `/in/${publicIdentifier}`
            : null;

          const participantHeadline =
            (miniProfile?.occupation as string | undefined) ??
            (miniProfile?.headline as string | undefined) ??
            (participantEntity?.headline as string | undefined) ??
            null;

          // Profile picture — usually nested in picture.rootUrl + artifacts
          const pictureObj =
            (miniProfile?.picture as Record<string, unknown> | undefined) ??
            (participantEntity?.picture as Record<string, unknown> | undefined);
          let participantProfilePicUrl: string | null = null;
          if (pictureObj) {
            const rootUrl = pictureObj.rootUrl as string | undefined;
            const artifacts = pictureObj.artifacts as Array<Record<string, unknown>> | undefined;
            if (rootUrl && artifacts && artifacts.length > 0) {
              const lastArtifact = artifacts[artifacts.length - 1];
              participantProfilePicUrl =
                rootUrl + (lastArtifact.fileIdentifyingUrlPathSegment as string ?? "");
            }
          }

          const participantUrn =
            participantEntity?.entityUrn as string | undefined ?? null;

          return {
            entityUrn,
            conversationId,
            participantName,
            participantUrn,
            participantProfileUrl,
            participantHeadline,
            participantProfilePicUrl,
            lastActivityAt,
            unreadCount,
            lastMessageSnippet,
          };
        })
        .filter((c): c is VoyagerConversation => c !== null);
    } catch (err) {
      console.error("[VoyagerClient] parseConversations error:", err);
      return [];
    }
  }

  /**
   * Parse the LinkedIn Voyager normalized response into VoyagerMessage objects.
   *
   * Similar to parseConversations — defensive parsing with null coalescing.
   * Message body may be in body.text or body directly depending on endpoint version.
   */
  private parseMessages(data: Record<string, unknown>): VoyagerMessage[] {
    try {
      const included = (data.included ?? []) as Array<Record<string, unknown>>;

      const dataInner = data.data as Record<string, unknown> | undefined;
      const elementUrns =
        (dataInner?.["*elements"] as string[] | undefined) ??
        (dataInner?.elements as string[] | undefined) ??
        [];

      // Build entity map
      const entityMap = new Map<string, Record<string, unknown>>();
      for (const item of included) {
        const urn = item.entityUrn as string | undefined;
        if (urn) entityMap.set(urn, item);
      }

      let messageEntities: Array<Record<string, unknown>> = [];

      if (elementUrns.length > 0) {
        messageEntities = elementUrns
          .map((urn) => entityMap.get(urn))
          .filter((e): e is Record<string, unknown> => !!e);
      } else {
        messageEntities = included.filter((item) => {
          const t = item.$type as string | undefined;
          return (
            t?.includes("MessengerMessage") ||
            t?.includes("MessagingEvent") ||
            t?.includes("Event")
          );
        });
      }

      return messageEntities
        .map((msg): VoyagerMessage | null => {
          const eventUrn = (msg.entityUrn as string | undefined) ?? null;
          if (!eventUrn) return null;

          // Sender URN — may be in sender.entityUrn, from, or participantUrn
          const senderObj = msg.sender as Record<string, unknown> | undefined;
          let senderUrn =
            (senderObj?.entityUrn as string | undefined) ??
            (msg.from as string | undefined) ??
            (msg.senderUrn as string | undefined) ??
            "";

          // Legacy format uses *from field
          if (!senderUrn) {
            senderUrn = (msg["*from"] as string | undefined) ?? "";
          }

          // Sender name — may be in sender.name or resolved from entity map
          const senderName =
            (senderObj?.name as string | undefined) ?? null;

          // Message body — check nested body.text, body.attributes, or direct body
          const bodyObj = msg.body as Record<string, unknown> | string | undefined;
          let bodyText = "";
          if (typeof bodyObj === "string") {
            bodyText = bodyObj;
          } else if (bodyObj && typeof bodyObj === "object") {
            bodyText =
              (bodyObj.text as string | undefined) ??
              ((bodyObj.attributes as Array<Record<string, unknown>> | undefined)?.[0]
                ?.text as string | undefined) ??
              "";
          }

          // Fallback: legacy format has body in eventContent.attributedBody.text
          if (!bodyText) {
            const eventContent = msg.eventContent as Record<string, unknown> | undefined;
            const attrBody = eventContent?.attributedBody as Record<string, unknown> | undefined;
            if (attrBody?.text) bodyText = attrBody.text as string;
            // Also check eventContent.body if it's non-empty
            if (!bodyText) {
              const ecBody = eventContent?.body as string | undefined;
              if (ecBody) bodyText = ecBody;
            }
          }

          // Extract URLs from attachments / renderContent / eventContent
          // LinkedIn puts links, images, and media in these fields, not in body.text
          const attachmentUrls: string[] = [];
          try {
            // Check renderContent (GraphQL) and renderContentUnions
            const rcSources = [
              msg.renderContent as Array<Record<string, unknown>> | undefined,
              msg.renderContentUnions as Array<Record<string, unknown>> | undefined,
            ];
            for (const rcList of rcSources) {
              if (!rcList) continue;
              for (const rcu of rcList) {
                const extMedia = rcu.externalMedia as Record<string, unknown> | undefined;
                if (extMedia?.url) attachmentUrls.push(extMedia.url as string);
                const article = rcu.article as Record<string, unknown> | undefined;
                if (article?.url) attachmentUrls.push(article.url as string);
                const file = rcu.file as Record<string, unknown> | undefined;
                if (file?.name) attachmentUrls.push(`[${file.name}]`);
              }
            }
            // Also check eventContent (older message format)
            const eventContent = msg.eventContent as Record<string, unknown> | undefined;
            const msgEvent = eventContent?.messageEvent as Record<string, unknown> | undefined;
            const attachments = msgEvent?.attachments as Array<Record<string, unknown>> | undefined;
            if (attachments) {
              for (const att of attachments) {
                const ref = att.reference as Record<string, unknown> | undefined;
                const url = (ref?.url as string | undefined) ?? (att.url as string | undefined);
                if (url) attachmentUrls.push(url);
              }
            }
            // Check top-level attachments field
            const topAttachments = msg.attachments as Array<Record<string, unknown>> | undefined;
            if (topAttachments) {
              for (const att of topAttachments) {
                const url = (att.url as string | undefined) ??
                  (att.reference as Record<string, unknown> | undefined)?.url as string | undefined;
                if (url) attachmentUrls.push(url);
              }
            }
            // Fallback: renderContentFallbackText often contains the URL as plain text
            if (attachmentUrls.length === 0) {
              const fallback = msg.renderContentFallbackText as string | undefined;
              if (fallback) {
                const urlMatches = fallback.match(/https?:\/\/[^\s]+/g);
                if (urlMatches) attachmentUrls.push(...urlMatches);
                else if (fallback.trim()) attachmentUrls.push(fallback.trim());
              }
            }
          } catch {
            // Attachment parsing is best-effort
          }

          // Append extracted URLs to body text
          if (attachmentUrls.length > 0) {
            const urlSuffix = attachmentUrls.join("\n");
            bodyText = bodyText ? `${bodyText}\n${urlSuffix}` : urlSuffix;
          }

          // Timestamp — look for deliveredAt or createdAt (epoch ms)
          const deliveredAt =
            (msg.deliveredAt as number | undefined) ??
            (msg.createdAt as number | undefined) ??
            0;

          return {
            eventUrn,
            senderUrn,
            senderName,
            body: bodyText,
            deliveredAt,
          };
        })
        .filter((m): m is VoyagerMessage => m !== null);
    } catch (err) {
      console.error("[VoyagerClient] parseMessages error:", err);
      return [];
    }
  }

  // ─── Invitation Withdrawal ──────────────────────────────────────────────────

  /**
   * Fetch sent connection invitations from LinkedIn.
   *
   * GETs /relationships/sentInvitationViewsV2 with pagination support.
   * Parses the normalized response to extract invitation details needed
   * for withdrawal (invitationId, sharedSecret).
   */
  async getSentInvitations(start = 0, count = 100): Promise<SentInvitation[]> {
    try {
      const response = await this.request(
        `/relationships/sentInvitationViewsV2?start=${start}&count=${count}&invitationType=CONNECTION&q=invitationType`
      );

      if (
        response.url.includes("/checkpoint/") ||
        response.url.includes("/challenge/")
      ) {
        console.warn("[VoyagerClient] getSentInvitations: checkpoint detected");
        return [];
      }

      const data = (await response.json()) as Record<string, unknown>;

      // LinkedIn returns normalized format: included[] contains invitation entities
      const included = (data.included ?? []) as Array<Record<string, unknown>>;

      // Also try data.data?.elements or data.data?.["*elements"] for direct element list
      const dataInner = data.data as Record<string, unknown> | undefined;
      const elementUrns =
        (dataInner?.["*elements"] as string[] | undefined) ??
        (dataInner?.elements as string[] | undefined) ??
        [];

      // Build entity map for lookups
      const entityMap = new Map<string, Record<string, unknown>>();
      for (const item of included) {
        const urn = item.entityUrn as string | undefined;
        if (urn) entityMap.set(urn, item);
      }

      const invitations: SentInvitation[] = [];

      // Strategy 1: Parse from element URNs pointing into entityMap
      if (elementUrns.length > 0) {
        for (const urn of elementUrns) {
          const entity = entityMap.get(urn);
          if (!entity) continue;
          const parsed = this.parseInvitationEntity(entity, entityMap);
          if (parsed) invitations.push(parsed);
        }
      }

      // Strategy 2: Scan included[] for invitation-typed entities
      if (invitations.length === 0) {
        for (const item of included) {
          const type = item.$type as string | undefined;
          const urn = item.entityUrn as string | undefined;
          if (
            urn &&
            (INVITATION_URN_PREFIXES.some(p => urn.includes(p)) ||
              type?.includes("Invitation") ||
              type?.includes("SentInvitationView"))
          ) {
            const parsed = this.parseInvitationEntity(item, entityMap);
            if (parsed) invitations.push(parsed);
          }
        }
      }

      console.log(
        `[VoyagerClient] getSentInvitations: parsed ${invitations.length} invitations (start=${start}, count=${count})`
      );
      return invitations;
    } catch (err) {
      if (err instanceof VoyagerError) {
        console.error(
          `[VoyagerClient] getSentInvitations failed: HTTP ${err.status}`
        );
        // Propagate rate-limit and auth errors so the worker can handle them
        if (err.status === 429 || err.status === 403) {
          throw err;
        }
      } else {
        console.error("[VoyagerClient] getSentInvitations error:", err);
      }
      // Only swallow genuinely ambiguous errors (unexpected shapes, parsing failures)
      return [];
    }
  }

  /**
   * Parse a single invitation entity from the normalized response.
   * Defensively handles multiple response shapes and all three URN formats
   * (fsd_invitation, fs_relInvitation, invitation).
   */
  private parseInvitationEntity(
    entity: Record<string, unknown>,
    entityMap: Map<string, Record<string, unknown>>
  ): SentInvitation | null {
    // entityUrn: "urn:li:fsd_invitation:123456", "urn:li:fs_relInvitation:67890",
    // or "urn:li:invitation:11111" — may also be nested in invitation ref
    let entityUrn = entity.entityUrn as string | undefined;

    // Some responses nest the invitation under a "*invitation" pointer
    const invitationRef = entity["*invitation"] as string | undefined;
    if (invitationRef && entityMap.has(invitationRef)) {
      const nested = entityMap.get(invitationRef)!;
      entityUrn = entityUrn ?? (nested.entityUrn as string | undefined);
      // Merge nested fields for parsing
      entity = { ...nested, ...entity };
    }

    if (!entityUrn) return null;

    // Extract numeric invitation ID from URN using shared regex
    const invitationId = parseInvitationId(entityUrn);
    if (!invitationId) return null;

    // sharedSecret — may be at top level or nested
    const sharedSecret =
      (entity.sharedSecret as string | undefined) ??
      (entity.invitationSharedSecret as string | undefined) ??
      "";

    // toMemberId — from invitee, toMember, or toMemberId fields
    let toMemberId = (entity.toMemberId as string | undefined) ?? "";
    if (!toMemberId) {
      const invitee = entity.invitee as Record<string, unknown> | undefined;
      const inviteeUnion = invitee?.inviteeUnion as Record<string, unknown> | undefined;
      const memberProfile = inviteeUnion?.memberProfile as string | undefined;
      if (memberProfile) {
        // "urn:li:fsd_profile:ACoAAA..." -> extract the ID
        toMemberId = memberProfile.split(":").pop() ?? "";
      }
    }
    if (!toMemberId) {
      const toMemberUrn = entity["*toMember"] as string | undefined;
      if (toMemberUrn) {
        toMemberId = toMemberUrn.split(":").pop() ?? "";
      }
    }

    // sentTime — epoch ms
    const sentTime =
      (entity.sentTime as number | undefined) ??
      (entity.sentAt as number | undefined) ??
      (entity.createdAt as number | undefined) ??
      0;

    return {
      entityUrn,
      invitationId,
      sharedSecret,
      toMemberId,
      sentTime,
    };
  }

  /**
   * Withdraw a specific sent invitation by ID and shared secret.
   *
   * Tries the primary REST endpoint first, then the Dash variant if the
   * primary returns 404.
   */
  async withdrawInvitation(
    invitationId: string,
    sharedSecret: string,
    entityUrn?: string
  ): Promise<ActionResult> {
    if (!sharedSecret) {
      return { success: false, error: "missing_shared_secret" };
    }

    const body = {
      invitationId,
      invitationSharedSecret: sharedSecret,
      isGenericInvitation: false,
    };

    try {
      // Primary endpoint
      await this.request(
        `/relationships/invitations/${invitationId}?action=withdraw`,
        {
          method: "POST",
          body: JSON.stringify(body),
          extraHeaders: {
            "Content-Type": "application/json",
          },
        }
      );

      console.log(
        `[VoyagerClient] withdrawInvitation: success (id=${invitationId})`
      );
      return { success: true, details: { invitationId } };
    } catch (err) {
      // If primary returns 404, try the Dash variant
      if (err instanceof VoyagerError && err.status === 404) {
        console.log(
          `[VoyagerClient] withdrawInvitation: primary 404, trying Dash variant`
        );
        try {
          const urnValid = entityUrn && INVITATION_URN_RE.test(entityUrn);
          const dashUrn = encodeURIComponent(
            urnValid ? entityUrn : `urn:li:fsd_invitation:${invitationId}`
          );
          await this.request(
            `/voyagerRelationshipsDashInvitations/${dashUrn}?action=withdraw`,
            {
              method: "POST",
              body: JSON.stringify(body),
              extraHeaders: {
                "Content-Type": "application/json",
              },
            }
          );

          console.log(
            `[VoyagerClient] withdrawInvitation: Dash variant success (id=${invitationId})`
          );
          return { success: true, details: { invitationId, endpoint: "dash" } };
        } catch (dashErr) {
          return this.handleError(dashErr);
        }
      }

      return this.handleError(err);
    }
  }

  /**
   * Withdraw a pending connection request for a given LinkedIn profile URL.
   *
   * Orchestrator method: fetches sent invitations, finds the matching one,
   * and calls withdrawInvitation(). Handles pagination (up to 500 invitations).
   */
  async withdrawConnection(profileUrl: string): Promise<ActionResult> {
    try {
      const profileId = this.extractProfileId(profileUrl);
      if (!profileId) {
        return { success: false, error: "invalid_profile_url" };
      }

      // View profile to get memberUrn for matching
      const profileResult = await this.viewProfile(profileUrl);
      const memberUrn = profileResult.success
        ? (profileResult.details?.memberUrn as string | undefined)
        : undefined;

      // If viewProfile failed and we have no memberUrn, we cannot reliably
      // match the invitation. Return failure instead of a misleading noop.
      if (!memberUrn) {
        console.warn(
          `[VoyagerClient] withdrawConnection: viewProfile failed for ${profileId}, cannot resolve memberUrn`
        );
        return {
          success: false,
          error: "Failed to resolve memberUrn for withdrawal",
        };
      }

      // Fetch sent invitations with pagination (up to 500)
      const allInvitations: SentInvitation[] = [];
      const PAGE_SIZE = 100;
      const MAX_PAGES = 5;

      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = await this.getSentInvitations(
          page * PAGE_SIZE,
          PAGE_SIZE
        );
        allInvitations.push(...batch);

        // Stop if we got fewer than requested (no more pages)
        if (batch.length < PAGE_SIZE) break;

        // Small delay between pagination requests
        await randomDelay(500, 1000);
      }

      console.log(
        `[VoyagerClient] withdrawConnection: fetched ${allInvitations.length} total invitations, looking for profileId=${profileId} / memberUrn=${memberUrn}`
      );

      // Find matching invitation by memberUrn (most reliable) or profileId slug fallback
      const match = allInvitations.find((inv) => {
        if (!inv.toMemberId) return false;

        // Match by memberUrn (most reliable)
        if (
          inv.toMemberId === memberUrn ||
          inv.toMemberId.includes(memberUrn)
        ) {
          return true;
        }

        // Fallback: match by profileId slug (e.g. toMemberId contains the profileId string)
        if (profileId && inv.toMemberId.includes(profileId)) {
          return true;
        }

        return false;
      });

      if (!match) {
        console.log(
          `[VoyagerClient] withdrawConnection: invitation not found for ${profileId}`
        );
        return {
          success: true,
          details: {
            noop: true,
            reason:
              "invitation not found (may already be withdrawn or accepted)",
            profileId,
            invitationsChecked: allInvitations.length,
          },
        };
      }

      console.log(
        `[VoyagerClient] withdrawConnection: found invitation ${match.invitationId} for ${profileId}`
      );

      // Add delay before withdrawal to mimic human behavior
      await randomDelay();

      return await this.withdrawInvitation(
        match.invitationId,
        match.sharedSecret,
        match.entityUrn
      );
    } catch (err) {
      return this.handleError(err);
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
