import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { getCampaign } from "@/lib/campaigns/operations";

// POST /api/campaigns/[id]/spam-check — run content spam check via EmailGuard
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Check if EmailGuard is configured
  if (!process.env.EMAILGUARD_API_TOKEN) {
    return NextResponse.json({ available: false });
  }

  try {
    const { id } = await params;
    const campaign = await getCampaign(id);

    if (!campaign) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Extract content from email sequence steps
    const emailSequence = campaign.emailSequence as Array<{
      subjectLine?: string;
      subjectVariantB?: string;
      body?: string;
    }> | null;

    if (!emailSequence || emailSequence.length === 0) {
      return NextResponse.json(
        { error: "No email content to check" },
        { status: 400 },
      );
    }

    // Combine all sequence content for spam checking
    const contentParts: string[] = [];
    for (const step of emailSequence) {
      if (step.subjectLine) contentParts.push(step.subjectLine);
      if (step.subjectVariantB) contentParts.push(step.subjectVariantB);
      if (step.body) contentParts.push(step.body);
    }

    const content = contentParts.join("\n\n");

    if (!content.trim()) {
      return NextResponse.json(
        { error: "No email content to check" },
        { status: 400 },
      );
    }

    // Lazy import to avoid loading client when token is missing
    const { emailguard } = await import("@/lib/emailguard/client");
    const result = await emailguard.checkContentSpam(content);
    const msg = result.message;

    // Map new API shape to a stable response for the frontend
    const verdict = msg.is_spam ? "spam" : msg.spam_score > 3 ? "suspicious" : "clean";

    return NextResponse.json({
      available: true,
      score: msg.spam_score,
      verdict,
      details: msg.spam_words,
      is_spam: msg.is_spam,
      number_of_spam_words: msg.number_of_spam_words,
    });
  } catch (err) {
    console.error("[POST /api/campaigns/[id]/spam-check] Error:", err);
    return NextResponse.json(
      { error: "Failed to run spam check" },
      { status: 500 },
    );
  }
}
