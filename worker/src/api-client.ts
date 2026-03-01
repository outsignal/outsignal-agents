/**
 * API client for the worker to communicate with the Vercel-hosted API.
 * Authenticates with WORKER_API_SECRET via Bearer token.
 */

interface ActionItem {
  id: string;
  personId: string;
  actionType: "connect" | "message" | "profile_view" | "check_connection";
  messageBody: string | null;
  priority: number;
  workspaceSlug: string;
  campaignName: string | null;
  linkedinUrl: string | null;
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
   * Get senders for a workspace.
   */
  async getSenders(workspaceSlug: string): Promise<SenderItem[]> {
    const result = await this.request<{ senders: SenderItem[] }>(
      `/api/linkedin/senders?workspace=${workspaceSlug}`,
    );
    return result.senders;
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
}
