import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate an embedding vector for a single text string.
 * Truncates to 8000 chars to stay within token limit safety margin.
 */
export async function embedText(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple text strings in a single API call.
 * OpenAI supports batching up to 2048 inputs.
 * Returns embeddings in the same order as the input array.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts.map((t) => t.slice(0, 8000)),
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
