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

export async function POST(request: Request) {
  const { messages, context } = await request.json();

  const modelMessages = await convertToModelMessages(messages, {
    tools: orchestratorTools,
  });

  const result = streamText({
    model: anthropic(orchestratorConfig.model),
    system: buildSystemPrompt(context ?? {}),
    messages: modelMessages,
    tools: orchestratorTools,
    stopWhen: stepCountIs(12),
  });

  return result.toUIMessageStreamResponse();
}
