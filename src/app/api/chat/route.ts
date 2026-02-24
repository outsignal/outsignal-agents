import { streamText, stepCountIs, convertToModelMessages } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { chatTools } from "@/lib/chat/tools";

interface ChatContext {
  pathname?: string;
  workspaceSlug?: string;
}

function buildSystemPrompt(context: ChatContext): string {
  const lines = [
    "You are the Outsignal AI Assistant, an internal tool for a cold outbound agency that manages multiple client workspaces.",
    "",
    "You help the team with:",
    "- Checking campaign performance (open rates, reply rates, bounce rates)",
    "- Querying workspace data, leads, and replies",
    "- Reviewing sender email health (flagging high bounce rates)",
    "- Drafting outbound email copy based on client ICP and offers",
    "- Creating and managing proposals",
    "- Summarising workspace configuration and campaign status",
    "",
    "Guidelines:",
    "- Be concise and action-oriented",
    "- Use markdown tables for tabular data",
    "- Monetary values from the database are in pence — divide by 100 for pounds (£)",
    "- When the user asks about 'this workspace' or 'campaigns', use the current workspace context if available",
    "- For email copy drafts, always reference the workspace ICP, offers, and pain points from the workspace info tool",
    "- If a tool call fails, explain the error clearly and suggest alternatives",
  ];

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
    tools: chatTools,
  });

  const result = streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: buildSystemPrompt(context ?? {}),
    messages: modelMessages,
    tools: chatTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
