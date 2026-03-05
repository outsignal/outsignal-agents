import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  orchestratorTools,
  orchestratorConfig,
} from "@/lib/agents/orchestrator";

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
  const { messages, context } = await request.json();

  const modelMessages = await convertToModelMessages(messages, {
    tools: orchestratorTools,
  });

  const result = streamText({
    model: anthropic(orchestratorConfig.model),
    system: buildSystemPrompt(context ?? {}),
    messages: trimMessages(modelMessages),
    tools: orchestratorTools,
    stopWhen: stepCountIs(12),
  });

  return result.toUIMessageStreamResponse();
}
