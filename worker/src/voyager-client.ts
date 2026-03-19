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
      await this.request("/voyagerMessagingDashMessengerConversations?count=1");
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
   * Fetch the last N LinkedIn messaging conversations for the authenticated user.
   *
   * Calls LinkedIn's Voyager messaging API. Returns rich metadata including
   * participant info (name, profile URL, headline, profile picture) and
   * a snippet of the last message. Parsing is defensive — returns empty array
   * on unexpected response shapes rather than crashing.
   *
   * IMPORTANT: Log raw response on first run so parser can be validated against
   * live data — the Voyager response schema may differ from expectations.
   */
  async fetchConversations(limit: number = 20): Promise<VoyagerConversation[]> {
    try {
      let response: Response;
      let usedLegacyEndpoint = false;

      // Tier 1: New DashMessenger endpoint with LEGACY_INBOX keyVersion
      try {
        response = await this.request(
          `/voyagerMessagingDashMessengerConversations?keyVersion=LEGACY_INBOX&q=all&count=${limit}`
        );
      } catch (err) {
        if (err instanceof VoyagerError && (err.status === 400 || err.status === 404)) {
          // Tier 2: New DashMessenger endpoint without keyVersion
          console.log(
            "[VoyagerClient] LEGACY_INBOX DashMessenger endpoint failed (400/404), trying without keyVersion..."
          );
          try {
            response = await this.request(
              `/voyagerMessagingDashMessengerConversations?q=all&count=${limit}`
            );
          } catch (err2) {
            if (err2 instanceof VoyagerError && (err2.status === 400 || err2.status === 404)) {
              // Tier 3: Legacy REST messaging endpoint — requires keyVersion=LEGACY_INBOX,
              // uses createdBefore (epoch ms) for pagination, no count param.
              console.log(
                "[VoyagerClient] DashMessenger failed (400/404), falling back to legacy /messaging/conversations..."
              );
              const createdBefore = Date.now();
              response = await this.request(
                `/messaging/conversations?keyVersion=LEGACY_INBOX&createdBefore=${createdBefore}`
              );
              usedLegacyEndpoint = true;
            } else {
              throw err2;
            }
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

      // Log raw response on first call for debugging the actual shape
      console.log(
        "[VoyagerClient] fetchConversations raw (first 3000 chars):",
        JSON.stringify(data).slice(0, 3000)
      );

      return this.parseConversations(data, usedLegacyEndpoint);
    } catch (err) {
      if (err instanceof VoyagerError) throw err;
      throw new VoyagerError(0, String(err));
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
    count: number = 20
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
        // On 404, try the legacy endpoint
        if (err instanceof VoyagerError && err.status === 404) {
          response = await this.request(
            `/messaging/conversations/${conversationId}/events?count=${count}`
          );
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

      // Log raw response on first call for debugging
      console.log(
        "[VoyagerClient] fetchMessages raw (first 3000 chars):",
        JSON.stringify(data).slice(0, 3000)
      );

      return this.parseMessages(data);
    } catch (err) {
      if (err instanceof VoyagerError) throw err;
      throw new VoyagerError(0, String(err));
    }
  }

  /**
   * Parse the legacy /messaging/conversations REST response into VoyagerConversation objects.
   *
   * This endpoint returns { elements: Conversation[], paging: {} } at the top level.
   * Participant info is inline — each participant is an object keyed by the full
   * com.linkedin.voyager.messaging.MessagingMember type string, with a nested miniProfile.
   * Last message snippet is in the last event's eventContent MessageEvent attributedBody.
   */
  private parseLegacyConversations(
    elements: Array<Record<string, unknown>>
  ): VoyagerConversation[] {
    return elements
      .map((conv): VoyagerConversation | null => {
        const entityUrn = conv.entityUrn as string | undefined;
        if (!entityUrn) return null;

        const conversationId = entityUrn.split(":").pop() ?? entityUrn;
        const lastActivityAt = (conv.lastActivityAt as number | undefined) ?? 0;
        const unreadCount = (conv.unreadCount as number | undefined) ?? 0;

        // Participants — array of objects keyed by messaging member type
        const MEMBER_KEY = "com.linkedin.voyager.messaging.MessagingMember";
        let participantName: string | null = null;
        let participantUrn: string | null = null;
        let participantProfileUrl: string | null = null;
        let participantHeadline: string | null = null;
        let participantProfilePicUrl: string | null = null;

        const rawParticipants = conv.participants as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(rawParticipants)) {
          for (const p of rawParticipants) {
            const member = p[MEMBER_KEY] as Record<string, unknown> | undefined;
            if (!member) continue;

            participantUrn = (member.entityUrn as string | undefined) ?? null;

            const mini = member.miniProfile as Record<string, unknown> | undefined;
            if (mini) {
              const firstName = mini.firstName as string | undefined;
              const lastName = mini.lastName as string | undefined;
              if (firstName || lastName) {
                participantName = `${firstName ?? ""} ${lastName ?? ""}`.trim();
              }
              const pub = mini.publicIdentifier as string | undefined;
              if (pub) participantProfileUrl = `/in/${pub}`;
              participantHeadline =
                (mini.occupation as string | undefined) ??
                (mini.headline as string | undefined) ??
                null;

              // Profile picture
              const pic = mini.picture as Record<string, unknown> | undefined;
              if (pic) {
                const rootUrl = pic.rootUrl as string | undefined;
                const artifacts = pic.artifacts as Array<Record<string, unknown>> | undefined;
                if (rootUrl && artifacts && artifacts.length > 0) {
                  const last = artifacts[artifacts.length - 1];
                  participantProfilePicUrl =
                    rootUrl + ((last.fileIdentifyingUrlPathSegment as string) ?? "");
                }
              }
            }
            break; // Use first non-self participant
          }
        }

        // Last message snippet — from last event in events[]
        let lastMessageSnippet: string | null = null;
        const events = conv.events as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(events) && events.length > 0) {
          const lastEvent = events[events.length - 1];
          const eventContent = lastEvent.eventContent as Record<string, unknown> | undefined;
          if (eventContent) {
            const MSG_KEY = "com.linkedin.voyager.messaging.event.MessageEvent";
            const msgEvent = eventContent[MSG_KEY] as Record<string, unknown> | undefined;
            if (msgEvent) {
              const attributed = msgEvent.attributedBody as Record<string, unknown> | undefined;
              lastMessageSnippet = (attributed?.text as string | undefined) ?? null;
            }
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
        };
      })
      .filter((c): c is VoyagerConversation => c !== null);
  }

  /**
   * Parse the LinkedIn Voyager normalized response into VoyagerConversation objects.
   *
   * LinkedIn returns a normalized JSON format where conversations and their participant
   * entities are mixed together in an `included[]` array. This parser builds a lookup
   * map from participant URNs and then maps each conversation entity to the interface.
   */
  private parseConversations(
    data: Record<string, unknown>,
    legacyFormat = false
  ): VoyagerConversation[] {
    try {
      // Legacy /messaging/conversations endpoint returns { elements: Conversation[], paging: {} }
      // at the top level — no included[] entity map, participants are inline objects.
      if (legacyFormat || Array.isArray(data.elements)) {
        return this.parseLegacyConversations(
          (data.elements as Array<Record<string, unknown>> | undefined) ?? []
        );
      }

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
          const senderUrn =
            (senderObj?.entityUrn as string | undefined) ??
            (msg.from as string | undefined) ??
            (msg.senderUrn as string | undefined) ??
            "";

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
