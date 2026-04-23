import { task } from "@trigger.dev/sdk";
import { prisma } from "@/lib/db";
import { runAgent } from "@/lib/agents/runner";
import { writerConfig } from "@/lib/agents/writer";
import { postMessage } from "@/lib/slack";
import { getCrawlMarkdown } from "@/lib/icp/crawl-cache";
import { anthropicQueue } from "./queues";

export interface GenerateSuggestionPayload {
  replyId: string; // cuid from Reply table
  workspaceSlug: string;
}

export interface GenerateSuggestionNeedsEvidenceResult {
  status: "needs_evidence";
  reason: string;
  draft: null;
}

export interface GenerateSuggestionEvidenceReady {
  status: "ready";
  companyName: string;
  companyDomain: string;
  websiteMarkdown: string;
}

function hasWebsiteEvidence(markdown: string | null): markdown is string {
  return typeof markdown === "string" && markdown.trim().length > 0;
}

export async function loadReplySuggestionEvidence(params: {
  replyId: string;
  replyPersonId: string | null;
  replySenderEmail: string;
  replySenderName: string | null;
}): Promise<
  | GenerateSuggestionEvidenceReady
  | GenerateSuggestionNeedsEvidenceResult
> {
  const person = params.replyPersonId
    ? await prisma.person.findUnique({
        where: { id: params.replyPersonId },
        select: { company: true, companyDomain: true },
      })
    : await prisma.person.findUnique({
        where: { email: params.replySenderEmail },
        select: { company: true, companyDomain: true },
      });

  const companyName =
    person?.company?.trim() ||
    params.replySenderName?.trim() ||
    params.replySenderEmail;

  if (!person?.companyDomain) {
    return {
      status: "needs_evidence",
      reason: `No website content for ${companyName}. Manual reply required.`,
      draft: null,
    };
  }

  const websiteMarkdown = await getCrawlMarkdown(person.companyDomain);
  if (!hasWebsiteEvidence(websiteMarkdown)) {
    return {
      status: "needs_evidence",
      reason: `No website content for ${companyName}. Manual reply required.`,
      draft: null,
    };
  }

  return {
    status: "ready",
    companyName,
    companyDomain: person.companyDomain,
    websiteMarkdown,
  };
}

export async function runGenerateSuggestion(
  payload: GenerateSuggestionPayload,
) {
  const { replyId, workspaceSlug } = payload;

  try {
    // ----------------------------------------------------------------
    // Step 1: Load Reply + thread context from DB
    // ----------------------------------------------------------------

    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
    });

    if (!reply) {
      console.error(`[generate-suggestion] Reply not found: ${replyId}`);
      return { success: false, reason: "reply-not-found" };
    }

    // Idempotency guard — skip if already generated
    if (reply.aiSuggestedReply) {
      console.log(
        `[generate-suggestion] Already generated for reply ${replyId}, skipping`,
      );
      return { success: false, reason: "already-generated" };
    }

    const evidence = await loadReplySuggestionEvidence({
      replyId,
      replyPersonId: reply.personId,
      replySenderEmail: reply.senderEmail,
      replySenderName: reply.senderName,
    });
    if (evidence.status === "needs_evidence") {
      console.warn(
        `[generate-suggestion] ${evidence.reason} (reply ${replyId})`,
      );
      return evidence;
    }

    // Load workspace for Slack channel ID
    const workspace = await prisma.workspace.findUnique({
      where: { slug: workspaceSlug },
      select: { slackChannelId: true },
    });

      // Build thread context: fetch sibling replies in the same thread
    let threadReplies: Array<{
      senderName: string | null;
      senderEmail: string;
      bodyText: string;
      receivedAt: Date;
      direction: string;
    }> = [];

    if (reply.emailBisonParentId) {
      threadReplies = await prisma.reply.findMany({
        where: {
          workspaceSlug,
          emailBisonParentId: reply.emailBisonParentId,
          id: { not: replyId }, // exclude current reply
        },
        orderBy: { receivedAt: "asc" },
        select: {
          senderName: true,
          senderEmail: true,
          bodyText: true,
          receivedAt: true,
          direction: true,
        },
      });
    } else if (reply.leadEmail) {
      // Fallback: group by leadEmail + workspaceSlug
      threadReplies = await prisma.reply.findMany({
        where: {
          workspaceSlug,
          leadEmail: reply.leadEmail,
          id: { not: replyId }, // exclude current reply
        },
        orderBy: { receivedAt: "asc" },
        select: {
          senderName: true,
          senderEmail: true,
          bodyText: true,
          receivedAt: true,
          direction: true,
        },
      });
    }

      // ----------------------------------------------------------------
      // Step 2: Run writer agent (Reply Suggestion Mode)
      // ----------------------------------------------------------------

      // Build the user message — MUST start with "suggest reply" to activate reply mode
    const messageParts: string[] = [
      "suggest reply to inbound email",
      "",
      `Workspace: ${workspaceSlug}`,
      "",
      `Lead: ${reply.senderName ?? reply.senderEmail}`,
      `Email: ${reply.senderEmail}`,
      `Subject: ${reply.subject ?? "(no subject)"}`,
      `Classification: ${reply.intent ?? "unknown"} / ${reply.sentiment ?? "unknown"}`,
      `Campaign: ${reply.campaignName ?? "unknown"}`,
      "",
      "Their message:",
      reply.bodyText,
    ];

    messageParts.push("");
    messageParts.push(
      `Company website evidence (${evidence.companyDomain}):`,
    );
    messageParts.push(evidence.websiteMarkdown.slice(0, 2000));

    if (reply.outboundSubject || reply.outboundBody) {
      messageParts.push("");
      messageParts.push("Original outbound email they replied to:");
      if (reply.outboundSubject) {
        messageParts.push(`Subject: ${reply.outboundSubject}`);
      }
      if (reply.outboundBody) {
        messageParts.push(`Body: ${reply.outboundBody}`);
      }
    }

    if (threadReplies.length > 0) {
      messageParts.push("");
      messageParts.push("Thread history (oldest first):");
      for (const t of threadReplies) {
        const name = t.senderName ?? t.senderEmail;
        messageParts.push(`[${t.direction}] ${name}: ${t.bodyText}`);
      }
    }

      // Force tool usage — ensure the agent grounds its reply in workspace + KB context
    messageParts.push("");
    messageParts.push(
      "IMPORTANT: You MUST call getWorkspaceIntelligence and searchKnowledgeBase before drafting your reply. Ground your response in the client's vertical context and knowledge base intelligence.",
    );

    const userMessage = messageParts.join("\n");

    console.log(
      `[generate-suggestion] Running writer agent for reply ${replyId} (workspace: ${workspaceSlug})`,
    );

      // The writer in reply mode returns plain text (not JSON). Use result.text directly.
      // Use Sonnet for cost/speed — Opus is reserved for interactive Nova sessions.
    const suggestionWriterConfig = { ...writerConfig, model: "claude-sonnet-4-6" as const };
    const result = await runAgent(suggestionWriterConfig, userMessage, {
      triggeredBy: "trigger-task",
      workspaceSlug,
    });

      // Log tool usage from agent steps
    const toolNames = result.steps.map((s) => s.toolName);
    const uniqueTools = [...new Set(toolNames)];
    console.log(
      `[generate-suggestion] Suggestion tools used: [${uniqueTools.join(", ")}] (${toolNames.length} total calls)`,
    );

      // In reply mode the writer returns plain prose — use result.text directly
    let suggestion = result.text;

      // Strip any reasoning/preamble the model may have included before the actual reply
      // Common patterns: "Here's my suggested reply:\n\n...", "Based on the workspace context...\n\nHere's..."
      const replyMarkers = [
        /^[\s\S]*?(?:here(?:'s| is) (?:my |the |a )?suggested reply[:\s]*\n+)/i,
        /^[\s\S]*?(?:here(?:'s| is) (?:my |the |a )?(?:draft|response)[:\s]*\n+)/i,
        /^[\s\S]*?(?:suggested reply[:\s]*\n+)/i,
      ];

    for (const marker of replyMarkers) {
      const match = suggestion.match(marker);
      if (match) {
        suggestion = suggestion.slice(match[0].length).trim();
        console.log(
          `[generate-suggestion] Stripped reasoning preamble from suggestion for reply ${replyId}`,
        );
        break;
      }
    }

      // ----------------------------------------------------------------
      // Step 2b: Reply quality validation — ban overused patterns
      // ----------------------------------------------------------------

    const bannedPatterns = [
        { pattern: /quick question/i, name: "quick question" },
        { pattern: /\u2014/, name: "em dash" },
        { pattern: /\u2013/, name: "en dash" },
        { pattern: / - /, name: "hyphen separator" },
        { pattern: /I'd love to/i, name: "I'd love to" },
        { pattern: /I hope this email finds you/i, name: "hope this email finds you" },
        { pattern: /just following up/i, name: "just following up" },
        { pattern: /let me know/i, name: "let me know" },
        { pattern: /are you free/i, name: "are you free" },
        { pattern: /pick your brain/i, name: "pick your brain" },
        { pattern: /no worries/i, name: "no worries" },
        { pattern: /we'd love to/i, name: "we'd love to" },
        { pattern: /feel free to/i, name: "feel free to" },
      ];

    const violations = bannedPatterns.filter((p) => p.pattern.test(suggestion));

    if (violations.length > 0) {
      const violationNames = violations.map((v) => v.name).join(", ");
      console.warn(
        `[generate-suggestion] Banned patterns detected in suggestion for reply ${replyId}: ${violationNames}. Re-generating...`,
      );

        // Retry once with correction instruction
      const correctionMessage = `${userMessage}\n\nCORRECTION: Your previous reply contains banned patterns: ${violationNames}. Rewrite without these patterns. Keep the same intent but use natural, conversational language.`;

      const retryResult = await runAgent(suggestionWriterConfig, correctionMessage, {
        triggeredBy: "trigger-task",
        workspaceSlug,
      });

      const retrySuggestion = retryResult.text;
      const retryViolations = bannedPatterns.filter((p) =>
        p.pattern.test(retrySuggestion),
      );

      if (retryViolations.length > 0) {
        console.warn(
          `[generate-suggestion] Retry still has banned patterns for reply ${replyId}: ${retryViolations.map((v) => v.name).join(", ")}. Using retry result anyway.`,
        );
      }

      suggestion = retrySuggestion;

      // Log retry tool usage
      const retryToolNames = retryResult.steps.map((s) => s.toolName);
      console.log(
        `[generate-suggestion] Retry tools used: [${[...new Set(retryToolNames)].join(", ")}]`,
      );
    }

      // ----------------------------------------------------------------
      // Step 3: Persist aiSuggestedReply
      // ----------------------------------------------------------------

    await prisma.reply.update({
      where: { id: replyId },
      data: { aiSuggestedReply: suggestion },
    });

    console.log(
      `[generate-suggestion] Suggestion persisted for reply ${replyId} (${suggestion.length} chars)`,
    );

      // ----------------------------------------------------------------
      // Step 4: Send Slack follow-up
      // ----------------------------------------------------------------

    const senderLabel = reply.senderName ?? reply.senderEmail;
    const suggestionText = `*AI Suggested Reply for ${senderLabel}:*\n${suggestion}`;

    if (workspace?.slackChannelId) {
      await postMessage(workspace.slackChannelId, suggestionText).catch(
        () => {},
      );
    }

    const repliesChannelId = process.env.REPLIES_SLACK_CHANNEL_ID;
    if (repliesChannelId) {
      await postMessage(repliesChannelId, suggestionText).catch(() => {});
    }

    return {
      success: true,
      replyId,
      suggestionLength: suggestion.length,
      durationMs: result.durationMs,
      toolsUsed: uniqueTools,
      hadBannedPatterns: violations.length > 0,
    };
  } catch (err) {
    console.error(
      `[generate-suggestion] Failed for reply ${replyId}:`,
      err,
    );
    throw err; // Let Trigger.dev retry logic handle it
  }
}

export const generateSuggestion = task({
  id: "generate-suggestion",
  queue: anthropicQueue,
  maxDuration: 300, // 5 min — Opus + KB search + multi-step tool calls can take 60-120s, plus margin
  retry: {
    maxAttempts: 2,
    factor: 2,
    minTimeoutInMs: 5_000,
    maxTimeoutInMs: 30_000,
  },
  run: runGenerateSuggestion,
});
