import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  orchestratorTools,
  orchestratorConfig,
} from "@/lib/agents/orchestrator";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { sanitizePromptInput } from "@/lib/agents/utils";

export const maxDuration = 300; // 5 minutes — Leads Agent scoring can take 60-300s for large lists

interface ChatContext {
  pathname?: string;
  workspaceSlug?: string;
}

function buildSystemPrompt(context: ChatContext): string {
  const lines = [orchestratorConfig.systemPrompt];

  if (context.pathname) {
    lines.push("", `Current page: ${context.pathname}`);
  }
  if (context.workspaceSlug) {
    lines.push(`Current workspace: ${context.workspaceSlug}`);
  }

  return lines.join("\n");
}

const MAX_MESSAGES = 40; // ~20 back-and-forth turns

function trimMessages<T extends { role: string }>(msgs: T[]): T[] {
  if (msgs.length <= MAX_MESSAGES) return msgs;
  // Always keep system messages + last MAX_MESSAGES non-system messages
  const system = msgs.filter(m => m.role === 'system');
  const rest = msgs.filter(m => m.role !== 'system');
  return [...system, ...rest.slice(-MAX_MESSAGES)];
}

export async function POST(request: Request) {
  const session = await requireAdminAuth();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages, context } = body as { messages?: unknown; context?: unknown };

  // Structural validation
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages must be a non-empty array" }, { status: 400 });
  }
  for (const msg of messages) {
    if (typeof msg !== "object" || msg === null || !("role" in msg) || !("content" in msg)) {
      return Response.json({ error: "Each message must have role and content" }, { status: 400 });
    }
  }

  // Sanitize user message content to prevent prompt injection
  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      msg.content = sanitizePromptInput(msg.content);
    }
  }

  const safeContext: ChatContext = {
    pathname: typeof (context as ChatContext)?.pathname === "string" ? (context as ChatContext).pathname : undefined,
    workspaceSlug: typeof (context as ChatContext)?.workspaceSlug === "string" ? (context as ChatContext).workspaceSlug : undefined,
  };

  const modelMessages = await convertToModelMessages(messages, {
    tools: orchestratorTools,
  });

  const result = streamText({
    model: anthropic(orchestratorConfig.model),
    system: buildSystemPrompt(safeContext),
    messages: trimMessages(modelMessages),
    tools: orchestratorTools,
    stopWhen: stepCountIs(12),
  });

  return result.toUIMessageStreamResponse();
}
