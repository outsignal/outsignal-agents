import { tool } from "ai";
import { z } from "zod";
import { searchKnowledge } from "@/lib/knowledge/store";

/**
 * Shared searchKnowledgeBase tool for use across writer, leads, and orchestrator agents.
 *
 * Uses pgvector semantic similarity when embeddings are available,
 * falling back to keyword matching otherwise.
 */
export const searchKnowledgeBase = tool({
  description:
    "Search the Outsignal knowledge base for cold email and LinkedIn outreach best practices, frameworks, templates, and guidelines. Returns semantically relevant passages. Use this to ground content in proven strategies.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "Search query — e.g. 'subject line best practices', 'follow-up sequence', 'LinkedIn connection request'",
      ),
    tags: z
      .string()
      .optional()
      .describe(
        "Filter by tag — e.g. 'cold-email', 'linkedin', 'subject-lines'",
      ),
    limit: z
      .number()
      .optional()
      .default(8)
      .describe("Max results (default 8)"),
  }),
  execute: async ({ query, tags, limit }) => {
    const results = await searchKnowledge(query, { limit, tags });
    if (results.length === 0) {
      return {
        message:
          "No matching knowledge base entries found. Write based on your expertise.",
        results: [],
      };
    }
    return {
      message: `Found ${results.length} relevant passage(s).`,
      results: results.map((r) => ({
        source: r.title,
        content: r.chunk,
      })),
    };
  },
});
