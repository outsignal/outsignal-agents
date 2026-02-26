import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { generateProposalToken } from "@/lib/tokens";
import { sendNotificationEmail } from "@/lib/resend";
import { notifyReply } from "@/lib/notifications";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
  NextRequest: class extends Request {},
}));

vi.mock("@/lib/tokens", () => ({
  generateProposalToken: vi.fn(() => "mock-token-123"),
}));

vi.mock("@/lib/resend", () => ({
  sendNotificationEmail: vi.fn(),
}));

vi.mock("@/lib/notifications", () => ({
  notifyReply: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function postRequest(data: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  });
}

// ── Proposals route ─────────────────────────────────────────────────────────

describe("GET /api/proposals", () => {
  let GET: typeof import("@/app/api/proposals/route").GET;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ GET } = await import("@/app/api/proposals/route"));
  });

  it("returns all proposals ordered by createdAt desc", async () => {
    const mockProposals = [
      { id: "2", clientName: "B", createdAt: new Date("2026-02-02") },
      { id: "1", clientName: "A", createdAt: new Date("2026-02-01") },
    ];
    vi.mocked(prisma.proposal.findMany).mockResolvedValue(mockProposals as never);

    const res = await GET();
    const body = await res.json();

    expect(prisma.proposal.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
    });
    expect(body).toEqual({ proposals: mockProposals });
  });
});

describe("POST /api/proposals", () => {
  let POST: typeof import("@/app/api/proposals/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST } = await import("@/app/api/proposals/route"));
  });

  // ── Validation ──────────────────────────────────────────────────────────

  it("returns 400 when clientName is missing", async () => {
    const req = postRequest({
      companyOverview: "Overview",
      packageType: "email",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/clientName/);
  });

  it("returns 400 when packageType is missing", async () => {
    const req = postRequest({
      clientName: "Alice",
      companyOverview: "Overview",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/packageType/);
  });

  it("returns 400 for invalid packageType", async () => {
    const req = postRequest({
      clientName: "Alice",
      companyOverview: "Overview",
      packageType: "carrier_pigeon",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid packageType");
  });

  // ── Successful creation ─────────────────────────────────────────────────

  it("creates proposal with default pricing when no overrides given", async () => {
    const createdProposal = {
      id: "p-1",
      token: "mock-token-123",
      clientName: "Alice",
      clientEmail: null,
      companyOverview: "Overview",
      packageType: "email",
      setupFee: 0,
      platformCost: 45000,
      retainerCost: 105000,
      status: "draft",
    };
    vi.mocked(prisma.proposal.create).mockResolvedValue(createdProposal as never);

    const req = postRequest({
      clientName: "Alice",
      companyOverview: "Overview",
      packageType: "email",
    });

    await POST(req);

    expect(prisma.proposal.create).toHaveBeenCalledWith({
      data: {
        token: "mock-token-123",
        clientName: "Alice",
        clientEmail: null,
        companyOverview: "Overview",
        packageType: "email",
        setupFee: 0,
        platformCost: 45000,
        retainerCost: 105000,
        status: "draft",
      },
    });
  });

  it("creates proposal with custom pricing overrides", async () => {
    const createdProposal = {
      id: "p-2",
      token: "mock-token-123",
      clientName: "Bob",
      clientEmail: null,
      companyOverview: "Custom corp",
      packageType: "linkedin",
      setupFee: 99000,
      platformCost: 20000,
      retainerCost: 50000,
      status: "draft",
    };
    vi.mocked(prisma.proposal.create).mockResolvedValue(createdProposal as never);

    const req = postRequest({
      clientName: "Bob",
      companyOverview: "Custom corp",
      packageType: "linkedin",
      setupFee: 99000,
      platformCost: 20000,
      retainerCost: 50000,
    });

    await POST(req);

    expect(prisma.proposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        setupFee: 99000,
        platformCost: 20000,
        retainerCost: 50000,
      }),
    });
  });

  it("sends email and updates status to 'sent' when clientEmail provided", async () => {
    const createdProposal = {
      id: "p-3",
      token: "mock-token-123",
      clientName: "Carol",
      clientEmail: "carol@example.com",
      status: "draft",
    };
    vi.mocked(prisma.proposal.create).mockResolvedValue(createdProposal as never);
    vi.mocked(sendNotificationEmail).mockResolvedValue(undefined);
    vi.mocked(prisma.proposal.update).mockResolvedValue({
      ...createdProposal,
      status: "sent",
    } as never);

    const req = postRequest({
      clientName: "Carol",
      clientEmail: "carol@example.com",
      companyOverview: "Overview",
      packageType: "email",
    });

    await POST(req);

    expect(sendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["carol@example.com"],
        subject: "Your proposal from Outsignal",
      }),
    );
    expect(prisma.proposal.update).toHaveBeenCalledWith({
      where: { id: "p-3" },
      data: { status: "sent" },
    });
  });

  it("leaves status as 'draft' when email sending fails", async () => {
    const createdProposal = {
      id: "p-4",
      token: "mock-token-123",
      clientName: "Dave",
      clientEmail: "dave@example.com",
      status: "draft",
    };
    vi.mocked(prisma.proposal.create).mockResolvedValue(createdProposal as never);
    vi.mocked(sendNotificationEmail).mockRejectedValue(new Error("SMTP down"));

    const req = postRequest({
      clientName: "Dave",
      clientEmail: "dave@example.com",
      companyOverview: "Overview",
      packageType: "email",
    });

    const res = await POST(req);
    const body = await res.json();

    // Email failed, so proposal.update should NOT have been called
    expect(prisma.proposal.update).not.toHaveBeenCalled();
    // The route should still return successfully with the proposal data
    expect(body).toHaveProperty("id", "p-4");
    expect(body).toHaveProperty("token", "mock-token-123");
  });

  it("returns proposal id, token, and url", async () => {
    const createdProposal = {
      id: "p-5",
      token: "mock-token-123",
      clientName: "Eve",
      clientEmail: null,
      status: "draft",
    };
    vi.mocked(prisma.proposal.create).mockResolvedValue(createdProposal as never);

    const req = postRequest({
      clientName: "Eve",
      companyOverview: "Overview",
      packageType: "email",
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body).toEqual({
      id: "p-5",
      token: "mock-token-123",
      url: "http://localhost:3000/p/mock-token-123",
    });
  });
});

// ── Webhook route ───────────────────────────────────────────────────────────

describe("POST /api/webhooks/emailbison", () => {
  let POST: typeof import("@/app/api/webhooks/emailbison/route").POST;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ POST } = await import("@/app/api/webhooks/emailbison/route"));
  });

  const makeWebhookRequest = (payload: unknown) =>
    postRequest(payload) as InstanceType<typeof import("next/server").NextRequest>;

  it("creates webhookEvent record", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);

    const payload = {
      event: "EMAIL_SENT",
      data: {
        workspace_slug: "acme",
        campaign_id: 42,
        lead_email: "lead@example.com",
        sender_email: "sender@example.com",
      },
    };

    await POST(makeWebhookRequest(payload));

    expect(prisma.webhookEvent.create).toHaveBeenCalledWith({
      data: {
        workspace: "acme",
        eventType: "EMAIL_SENT",
        campaignId: "42",
        leadEmail: "lead@example.com",
        senderEmail: "sender@example.com",
        payload: JSON.stringify(payload),
      },
    });
  });

  it("updates lead status for EMAIL_SENT event", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.person.updateMany).mockResolvedValue({ count: 1 } as never);

    const payload = {
      event: "EMAIL_SENT",
      data: { lead_email: "lead@example.com" },
    };

    await POST(makeWebhookRequest(payload));

    expect(prisma.person.updateMany).toHaveBeenCalledWith({
      where: { email: "lead@example.com" },
      data: { status: "contacted" },
    });
  });

  it("updates lead status for BOUNCE event", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.person.updateMany).mockResolvedValue({ count: 1 } as never);

    const payload = {
      event: "BOUNCE",
      data: { lead_email: "bounced@example.com" },
    };

    await POST(makeWebhookRequest(payload));

    expect(prisma.person.updateMany).toHaveBeenCalledWith({
      where: { email: "bounced@example.com" },
      data: { status: "bounced" },
    });
  });

  it("calls notifyReply for non-automated REPLY_RECEIVED", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.person.updateMany).mockResolvedValue({ count: 1 } as never);

    const payload = {
      event: "REPLY_RECEIVED",
      data: {
        workspace_slug: "acme",
        lead_email: "lead@example.com",
        sender_email: "sender@example.com",
        subject: "Re: Hello",
        text_body: "Thanks for reaching out!",
        automated_reply: false,
      },
    };

    await POST(makeWebhookRequest(payload));

    // Allow the microtask (.catch handler) to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(notifyReply).toHaveBeenCalledWith({
      workspaceSlug: "acme",
      leadEmail: "lead@example.com",
      senderEmail: "sender@example.com",
      subject: "Re: Hello",
      bodyPreview: "Thanks for reaching out!",
    });
  });

  it("does NOT call notifyReply for automated replies", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    vi.mocked(prisma.person.updateMany).mockResolvedValue({ count: 1 } as never);

    const payload = {
      event: "REPLY_RECEIVED",
      data: {
        workspace_slug: "acme",
        lead_email: "lead@example.com",
        sender_email: "sender@example.com",
        automated_reply: true,
      },
    };

    await POST(makeWebhookRequest(payload));
    await new Promise((r) => setTimeout(r, 0));

    expect(notifyReply).not.toHaveBeenCalled();
  });

  it("returns { received: true }", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);

    const payload = {
      event: "EMAIL_SENT",
      data: { lead_email: "lead@example.com" },
    };

    const res = await POST(makeWebhookRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
  });

  it("returns 500 on processing error", async () => {
    vi.mocked(prisma.webhookEvent.create).mockRejectedValue(
      new Error("DB connection lost"),
    );

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const payload = {
      event: "EMAIL_SENT",
      data: { lead_email: "lead@example.com" },
    };

    const res = await POST(makeWebhookRequest(payload));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Failed to process webhook" });

    consoleSpy.mockRestore();
  });
});
