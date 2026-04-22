/**
 * API client for the worker to communicate with the Vercel-hosted API.
 * Authenticates with WORKER_API_SECRET via Bearer token.
 */

interface ActionItem {
  id: string;
  personId: string;
  actionType:
    | "connect"
    | "connection_request"
    | "message"
    | "profile_view"
    | "check_connection"
    | "withdraw_connection";
  messageBody: string | null;
  priority: number;
  workspaceSlug: string;
  campaignName: string | null;
  linkedinUrl: string | null;
}

interface PlanResult {
  planned: number;
  campaigns: Array<{
    name: string;
    planned: number;
    remaining: number;
  }>;
  senders: Array<{
    name: string;
    budgetUsed: number;
    budgetRemaining: number;
  }>;
}

interface SenderItem {
  id: string;
  workspaceSlug: string;
  name: string;
  emailAddress: string | null;
  linkedinProfileUrl: string | null;
  sessionData: string | null;
  sessionStatus: string;
  proxyUrl: string | null;
  status: string;
  healthStatus: string;
  warmupDay: number;
  dailyConnectionLimit: number;
  dailyMessageLimit: number;
  dailyProfileViewLimit: number;
  lastActiveAt: string | null;
  lastKeepaliveAt: string | null;
}

interface SenderExecutionGuard {
  sender: {
    id: string;
    status: string;
    healthStatus: string;
    sessionStatus: string;
  };
  pausedCampaignNames: string[];
}

export class ApiClient {
  private baseUrl: string;
  private secret: string;

  constructor(baseUrl: string, secret: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.secret = secret;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.secret}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get active workspace slugs from the API.
   */
  async getWorkspaceSlugs(): Promise<string[]> {
    const result = await this.request<{ slugs: string[] }>("/api/linkedin/workspaces");
    return result.slugs;
  }

  /**
   * Get next batch of ready actions for a sender.
   */
  async getNextActions(senderId: string, limit: number = 10): Promise<ActionItem[]> {
    const result = await this.request<{ actions: ActionItem[] }>(
      `/api/linkedin/actions/next?senderId=${senderId}&limit=${limit}`,
    );
    return result.actions;
  }

  /**
   * Mark an action as complete.
   */
  async markComplete(actionId: string, result?: Record<string, unknown>): Promise<void> {
    await this.request(`/api/linkedin/actions/${actionId}/complete`, {
      method: "POST",
      body: JSON.stringify({ result }),
    });
  }

  /**
   * Mark an action as failed.
   */
  async markFailed(actionId: string, error: string): Promise<void> {
    await this.request(`/api/linkedin/actions/${actionId}/fail`, {
      method: "POST",
      body: JSON.stringify({ error }),
    });
  }

  /**
   * Mark an action as failed only if it is still running.
   * Used for sender timeout cleanup so late completions are not clobbered.
   */
  async markFailedIfRunning(actionId: string, error: string): Promise<void> {
    await this.request(`/api/linkedin/actions/${actionId}/fail`, {
      method: "POST",
      body: JSON.stringify({ error, onlyIfRunning: true }),
    });
  }

  /**
   * Get senders for a workspace.
   */
  async getSenders(workspaceSlug: string): Promise<SenderItem[]> {
    const result = await this.request<{ senders: SenderItem[] }>(
      `/api/linkedin/senders?workspace=${workspaceSlug}`,
    );
    return result.senders;
  }

  /**
   * Fetch execution-relevant pause state for a sender at tick start, with an
   * optional refresh after a spread sleep before the next claimed action.
   */
  async getExecutionGuard(senderId: string): Promise<SenderExecutionGuard> {
    return this.request<SenderExecutionGuard>(
      `/api/linkedin/senders/${senderId}/execution-guard`,
    );
  }

  /**
   * Get daily usage/budget for a sender.
   */
  async getUsage(senderId: string): Promise<Record<string, unknown>> {
    const result = await this.request<{ budget: Record<string, unknown> }>(
      `/api/linkedin/usage/${senderId}`,
    );
    return result.budget;
  }

  /**
   * Save session cookies for a sender (after successful login).
   * The API encrypts the cookies before storing.
   */
  async updateSession(senderId: string, cookies: unknown[]): Promise<void> {
    await this.request(`/api/linkedin/senders/${senderId}/session`, {
      method: "POST",
      body: JSON.stringify({ cookies }),
    });
  }

  /**
   * Get decrypted LinkedIn credentials for a sender.
   * Used for auto-login when session expires during worker processing.
   */
  async getSenderCredentials(
    senderId: string,
  ): Promise<{ email: string; password: string; totpSecret?: string } | null> {
    try {
      return await this.request<{
        email: string;
        password: string;
        totpSecret?: string;
      }>(`/api/linkedin/senders/${senderId}/credentials`);
    } catch {
      return null;
    }
  }

  /**
   * Save Voyager API cookies (li_at + JSESSIONID) for a sender.
   * These are stored encrypted in Sender.sessionData via the existing session endpoint.
   * The cookies are stored as a JSON object with type marker for the API to distinguish
   * from the old browser cookie array format.
   */
  async saveVoyagerCookies(
    senderId: string,
    cookies: { liAt: string; jsessionId: string },
  ): Promise<void> {
    await this.request(`/api/linkedin/senders/${senderId}/session`, {
      method: "POST",
      body: JSON.stringify({
        cookies: [
          { type: "voyager", liAt: cookies.liAt, jsessionId: cookies.jsessionId }
        ],
      }),
    });
  }

  /**
   * Load Voyager API cookies for a sender from the cookies endpoint.
   * Uses GET /api/linkedin/senders/{id}/cookies which decrypts sessionData server-side.
   * Returns null if no cookies are stored or if they're in the old browser format.
   */
  async getVoyagerCookies(
    senderId: string,
  ): Promise<{ liAt: string; jsessionId: string; proxyUrl?: string | null } | null> {
    try {
      const result = await this.request<{ cookies: unknown[]; proxyUrl?: string | null }>(
        `/api/linkedin/senders/${senderId}/cookies`,
      );

      // Look for voyager-type cookie entry
      if (Array.isArray(result.cookies)) {
        const voyagerEntry = result.cookies.find(
          (entry: any) => entry && typeof entry === 'object' && (entry as any).type === 'voyager'
        ) as { type: string; liAt: string; jsessionId: string } | undefined;

        if (voyagerEntry?.liAt && voyagerEntry?.jsessionId) {
          return {
            liAt: voyagerEntry.liAt,
            jsessionId: voyagerEntry.jsessionId,
            proxyUrl: result.proxyUrl ?? null,
          };
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Update the health status of a sender.
   * Called by the worker when it detects auth failures, IP blocks, or checkpoint challenges.
   * The fail action endpoint does NOT update sender health — only action status.
   */
  async updateSenderHealth(
    senderId: string,
    healthStatus: string,
  ): Promise<void> {
    await this.request(`/api/linkedin/senders/${senderId}/health`, {
      method: "PATCH",
      body: JSON.stringify({ healthStatus }),
    });
  }

  /**
   * Update the LinkedIn profile URL for a sender.
   * Called after login or during backfill when linkedinProfileUrl is null.
   */
  async updateSenderProfileUrl(
    senderId: string,
    linkedinProfileUrl: string,
  ): Promise<void> {
    await this.request(`/api/linkedin/senders/${senderId}/health`, {
      method: "PATCH",
      body: JSON.stringify({ linkedinProfileUrl }),
    });
  }

  /**
   * Report a successful keepalive for a sender.
   */
  async updateKeepalive(senderId: string): Promise<void> {
    await this.request(`/api/linkedin/senders/${senderId}/health`, {
      method: "PATCH",
      body: JSON.stringify({ lastKeepaliveAt: new Date().toISOString() }),
    });
  }

  /**
   * Get pending connections that need a live status check for a workspace.
   */
  async getConnectionsToCheck(
    workspaceSlug: string,
  ): Promise<
    {
      connectionId: string;
      senderId: string;
      personId: string;
      personLinkedinUrl: string;
    }[]
  > {
    const result = await this.request<{
      connections: {
        connectionId: string;
        senderId: string;
        personId: string;
        personLinkedinUrl: string;
      }[];
    }>(`/api/linkedin/connections/check?workspace=${workspaceSlug}`);
    return result.connections;
  }

  /**
   * Report the result of a connection status check.
   */
  async reportConnectionResult(
    connectionId: string,
    status: "connected" | "pending" | "not_connected",
  ): Promise<void> {
    await this.request(`/api/linkedin/connections/${connectionId}/result`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
  }

  /**
   * Check the database connection status for a person.
   * Returns the LinkedInConnection status if a record exists, or null if none found.
   * Used as a pre-send gate before executing message actions.
   */
  async getConnectionStatusForPerson(
    senderId: string,
    personId: string,
  ): Promise<{ status: string } | null> {
    try {
      return await this.request<{ status: string }>(
        `/api/linkedin/connections/person/${personId}/status?senderId=${senderId}`,
      );
    } catch {
      return null;
    }
  }

  /**
   * Push LinkedIn conversations and messages to the main app for processing.
   * Called by the worker when new inbound messages are detected during the poll loop.
   */
  async pushConversations(
    senderId: string,
    conversations: Array<{
      entityUrn: string;
      conversationId: string;
      participantName: string | null;
      participantUrn: string | null;
      participantProfileUrl: string | null;
      participantHeadline: string | null;
      participantProfilePicUrl: string | null;
      lastActivityAt: number;
      unreadCount: number;
      lastMessageSnippet: string | null;
      messages: Array<{
        eventUrn: string;
        senderUrn: string;
        senderName: string | null;
        body: string;
        deliveredAt: number;
      }>;
    }>,
  ): Promise<{ conversationsProcessed: number; newInboundMessages: number }> {
    return this.request<{ conversationsProcessed: number; newInboundMessages: number }>(
      "/api/linkedin/sync/push",
      {
        method: "POST",
        body: JSON.stringify({ senderId, conversations }),
      },
    );
  }

  /**
   * Trigger stuck-action recovery on the server.
   * Resets actions stuck in "running" status back to "pending" or "failed".
   */
  async recoverStuckActions(): Promise<{ recovered: number }> {
    return this.request<{ recovered: number }>(
      "/api/linkedin/actions/recover",
      { method: "POST" },
    );
  }

  /**
   * Run daily planning for a workspace (pull model).
   * Creates LinkedIn actions for unstarted people across active campaigns,
   * spread across business hours with per-sender budget awareness.
   */
  async planDay(workspaceSlug: string): Promise<PlanResult> {
    return this.request<PlanResult>("/api/linkedin/plan", {
      method: "POST",
      body: JSON.stringify({ workspaceSlug }),
    });
  }
}
