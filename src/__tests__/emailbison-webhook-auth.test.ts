import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

const notifyMock = vi.fn().mockResolvedValue(undefined);
const enqueueActionMock = vi.fn().mockResolvedValue("action-1");
const assignSenderForPersonMock = vi.fn().mockResolvedValue(null);
const evaluateSequenceRulesMock = vi.fn().mockResolvedValue([]);

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    }),
  },
  NextRequest: class extends Request {
    nextUrl: URL;

    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);
      this.nextUrl = new URL(typeof input === "string" ? input : input.toString());
    }
  },
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {},
}));

vi.mock("@/lib/notifications", () => ({
  notifyReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
}));

vi.mock("@/lib/linkedin/queue", () => ({
  cancelActionsForPerson: vi.fn().mockResolvedValue(undefined),
  enqueueAction: (...args: unknown[]) => enqueueActionMock(...args),
}));

vi.mock("@/lib/linkedin/sender", () => ({
  assignSenderForPerson: (...args: unknown[]) => assignSenderForPersonMock(...args),
}));

vi.mock("@/lib/linkedin/sequencing", () => ({
  evaluateSequenceRules: (...args: unknown[]) => evaluateSequenceRulesMock(...args),
}));

vi.mock("@/lib/classification/classify-reply", () => ({
  classifyReply: vi.fn().mockResolvedValue({ label: "neutral" }),
}));

vi.mock("@/lib/classification/strip-html", () => ({
  stripHtml: vi.fn((s: string) => s),
}));

function makeSignedRequest(payload: unknown, secret?: string): InstanceType<
  typeof import("next/server").NextRequest
> {
  const rawBody = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (secret) {
    headers["x-emailbison-signature"] = createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
  }

  return new NextRequest("http://localhost/api/webhooks/emailbison?workspace=acme", {
    method: "POST",
    body: rawBody,
    headers,
  });
}

describe("POST /api/webhooks/emailbison — auth", () => {
  let POST: typeof import("@/app/api/webhooks/emailbison/route").POST;
  const env = process.env as Record<string, string | undefined>;
  const secret = "test-emailbison-secret";

  beforeEach(async () => {
    vi.clearAllMocks();
    env.EMAILBISON_WEBHOOK_SECRET = secret;
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({} as never);
    ({ POST } = await import("@/app/api/webhooks/emailbison/route"));
  });

  it("accepts unsigned requests when webhook secret is not configured", async () => {
    delete env.EMAILBISON_WEBHOOK_SECRET;

    const res = await POST(
      makeSignedRequest({ event: "UNKNOWN", data: {} }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(prisma.webhookEvent.create).toHaveBeenCalled();
  });

  it("accepts unsigned requests when secret is configured but header is missing", async () => {
    const res = await POST(
      makeSignedRequest({ event: "UNKNOWN", data: {} }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(prisma.webhookEvent.create).toHaveBeenCalled();
  });

  it("accepts a valid signature and processes the event", async () => {
    const payload = {
      event: "UNKNOWN",
      data: {
        lead: { email: "lead@example.com" },
      },
    };

    const res = await POST(makeSignedRequest(payload, secret) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(prisma.webhookEvent.create).toHaveBeenCalled();
  });

  it("rejects an invalid signature when a signature header is present", async () => {
    const rawBody = JSON.stringify({ event: "UNKNOWN", data: {} });
    const res = await POST(
      new NextRequest("http://localhost/api/webhooks/emailbison?workspace=acme", {
        method: "POST",
        body: rawBody,
        headers: {
          "content-type": "application/json",
          "x-emailbison-signature": "deadbeef",
        },
      }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Invalid webhook signature" });
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
  });

  it("retries without externalEventId when the database is missing that column", async () => {
    const missingColumnError = Object.assign(
      new Error(
        "The column `externalEventId` does not exist in the current database.",
      ),
      {
        code: "P2022",
        meta: { modelName: "WebhookEvent", column: "externalEventId" },
      },
    );

    vi.mocked(prisma.webhookEvent.create)
      .mockRejectedValueOnce(missingColumnError)
      .mockResolvedValue({} as never);
    vi.mocked(prisma.webhookEvent.createMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.webhookEvent.findFirst).mockResolvedValue({ id: "webhook-compat" } as never);

    const res = await POST(
      makeSignedRequest({ event: "UNKNOWN", data: {} }) as never,
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.webhookEvent.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.webhookEvent.findFirst).toHaveBeenCalledTimes(1);
  });

  it("alerts ops instead of silently dropping a LinkedIn action when no sender can be assigned", async () => {
    vi.mocked(prisma.webhookEvent.create).mockResolvedValue({ id: "webhook-1" } as never);
    vi.mocked(prisma.campaign.findFirst).mockResolvedValue({
      name: "Lime LI",
      workspaceSlug: "acme",
      channels: JSON.stringify(["email", "linkedin"]),
    } as never);
    vi.mocked(prisma.person.findUnique).mockResolvedValue({
      id: "person-1",
      firstName: "Jordan",
      lastName: "Lee",
      company: "Acme",
      jobTitle: "COO",
      linkedinUrl: "https://linkedin.com/in/jordan",
      email: "lead@example.com",
    } as never);
    evaluateSequenceRulesMock.mockResolvedValue([
      {
        actionType: "connect",
        messageBody: null,
        delayMinutes: 5,
        sequenceStepRef: "rule_1",
        variantKey: null,
      },
    ]);
    assignSenderForPersonMock.mockResolvedValue(null);

    const payload = {
      event: "EMAIL_SENT",
      data: {
        campaign: { id: 42 },
        lead: { email: "lead@example.com" },
        sender_email: { email: "sender@example.com" },
        step_number: 1,
      },
    };

    const res = await POST(makeSignedRequest(payload, secret) as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(notifyMock).toHaveBeenCalledWith({
      type: "error",
      severity: "error",
      title:
        "LinkedIn action could not be assigned from EmailBison webhook",
      message: expect.stringContaining("Reason: no eligible LinkedIn sender was available for assignment"),
      workspaceSlug: "acme",
      metadata: expect.objectContaining({
        campaignName: "Lime LI",
        leadEmail: "lead@example.com",
        senderEmail: "sender@example.com",
        actionType: "connect",
        personId: "person-1",
        eventType: "EMAIL_SENT",
        externalEventId:
          "email_sent:42:lead@example.com:1:sender@example.com",
      }),
    });
    expect(enqueueActionMock).not.toHaveBeenCalled();
  });
});
