export interface OutboundContextMessage {
  id: "outbound-context";
  direction: "outbound";
  subject: string | null;
  bodyText: string;
  htmlBody: null;
  senderEmail: null;
  receivedAt: null;
  isOutboundContext: true;
  intent: null;
  sentiment: null;
  interested: false;
  aiSuggestedReply: null;
  ebSenderEmailId: null;
  emailBisonReplyId: null;
  senderName: null;
}

interface OutboundContextSource {
  outboundSubject: string | null;
  outboundBody: string | null;
}

export function buildOutboundContextMessage(
  source: OutboundContextSource | null | undefined,
): OutboundContextMessage | null {
  if (!source) return null;

  const outboundBody = source?.outboundBody?.trim();
  if (!outboundBody) return null;

  return {
    id: "outbound-context",
    direction: "outbound",
    subject: source.outboundSubject ?? null,
    bodyText: source.outboundBody ?? "",
    htmlBody: null,
    senderEmail: null,
    receivedAt: null,
    isOutboundContext: true,
    intent: null,
    sentiment: null,
    interested: false,
    aiSuggestedReply: null,
    ebSenderEmailId: null,
    emailBisonReplyId: null,
    senderName: null,
  };
}
