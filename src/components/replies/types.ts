/** Reply as returned from the /api/replies/feed endpoint */
export interface FeedReply {
  id: string;
  workspaceSlug: string;
  workspaceName: string;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
  bodyText: string;
  receivedAt: string;
  campaignName: string | null;
  campaignId: string | null;
  sequenceStep: number | null;
  intent: string | null;
  sentiment: string | null;
  objectionSubtype: string | null;
  classificationSummary: string | null;
  classifiedAt: string | null;
  overrideIntent: string | null;
  overrideSentiment: string | null;
  overrideObjSubtype: string | null;
  overriddenAt: string | null;
  outboundSubject: string | null;
  outboundBody: string | null;
  source: string;
  personId: string | null;
  effectiveIntent: string | null;
  effectiveSentiment: string | null;
  portalUrl: string;
}

/** Per-workspace stats from the feed endpoint */
export interface WorkspaceReplyStats {
  slug: string;
  name: string;
  replyCount7d: number;
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
}
