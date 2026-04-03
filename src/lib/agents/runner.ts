import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { prisma } from "@/lib/db";
import type { AgentConfig, AgentRunResult, ToolCallStep } from "./types";
import { loadMemoryContext } from "./memory";

/**
 * Run a specialist agent with the given configuration and user message.
 *
 * This is the core execution engine for all agents. It:
 * 1. Creates an AgentRun record for audit/debugging
 * 2. Calls generateText with the agent's model, system prompt, and tools
 * 3. Extracts tool call steps for the log
 * 4. Updates the AgentRun record with results
 * 5. Returns typed output + metadata
 */
export async function runAgent<TOutput = unknown>(
  config: AgentConfig,
  userMessage: string,
  options?: {
    triggeredBy?: string;
    workspaceSlug?: string;
    input?: unknown;
  },
): Promise<AgentRunResult<TOutput>> {
  const startTime = Date.now();

  // Create audit record
  const agentRun = await prisma.agentRun.create({
    data: {
      agent: config.name,
      workspaceSlug: options?.workspaceSlug ?? null,
      input: JSON.stringify({ message: userMessage }),
      status: "running",
      triggeredBy: options?.triggeredBy ?? "cli",
    },
  });

  try {
    // Load persistent memory context (best-effort, never fails the run)
    let memoryContext = "";
    try {
      memoryContext = await loadMemoryContext(options?.workspaceSlug);
    } catch (err) {
      console.warn("[runner] Memory context load failed, proceeding without:", err);
    }

    // Merge static prompt with dynamic memory
    const systemPrompt = memoryContext
      ? `${config.systemPrompt}\n\n${memoryContext}`
      : config.systemPrompt;

    const result = await generateText({
      model: anthropic(config.model),
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      tools: config.tools,
      stopWhen: stepCountIs(config.maxSteps ?? 10),
    });

    // Extract tool call steps from the response
    const steps: ToolCallStep[] = [];
    for (const step of result.steps) {
      for (const toolCall of step.toolCalls) {
        // Find matching result by toolCallId
        const toolResult = step.toolResults.find(
          (r) => r.toolCallId === toolCall.toolCallId,
        );
        steps.push({
          toolName: toolCall.toolName,
          args: (toolCall as { input?: unknown }).input as Record<
            string,
            unknown
          >,
          result: (toolResult as { output?: unknown })?.output ?? null,
        });
      }
    }

    const durationMs = Date.now() - startTime;

    // Try to parse structured output from the last text response
    let output: TOutput;
    try {
      // Look for JSON in the response text
      const jsonMatch = result.text.match(/```json\n([\s\S]*?)\n```/);
      let rawOutput: unknown;
      if (jsonMatch) {
        rawOutput = JSON.parse(jsonMatch[1]);
      } else {
        // Try parsing the whole text as JSON
        rawOutput = JSON.parse(result.text);
      }

      // Validate against schema if provided (graceful degradation)
      if (config.outputSchema) {
        const parsed = config.outputSchema.safeParse(rawOutput);
        if (!parsed.success) {
          console.error(
            `[Agent ${config.name}] Output validation failed:`,
            parsed.error,
          );
          // Still use raw output -- don't crash on validation failure
          output = rawOutput as TOutput;
        } else {
          output = parsed.data as TOutput;
        }
      } else {
        output = rawOutput as TOutput;
      }
    } catch {
      // If no structured output, use the raw text
      output = result.text as unknown as TOutput;
    }

    // Update audit record
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: "complete",
        output: JSON.stringify(output),
        steps: JSON.stringify(steps),
        durationMs,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        modelId: config.model,
      },
    });

    // Memory write-back hook (best-effort, never fails the run)
    if (config.onComplete) {
      try {
        await config.onComplete(
          { output, text: result.text, steps, durationMs },
          options,
        );
      } catch (hookError) {
        console.error(
          `[Agent ${config.name}] onComplete hook failed:`,
          hookError,
        );
      }
    }

    return {
      output,
      text: result.text,
      steps,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Update audit record with error
    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      },
    });

    throw error;
  }
}
