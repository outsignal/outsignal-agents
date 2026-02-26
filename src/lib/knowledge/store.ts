import { prisma } from "@/lib/db";

/**
 * Knowledge base store for cold outbound best practices and reference documents.
 *
 * Documents are split into chunks (~800 chars each, split on paragraph boundaries)
 * and stored in the database. The Writer Agent searches these chunks for relevant
 * context when generating copy.
 *
 * Currently uses simple text matching. Can be upgraded to embeddings later.
 */

const CHUNK_TARGET_SIZE = 800;
const CHUNK_MAX_SIZE = 1200;

/**
 * Split text into chunks on paragraph boundaries.
 * Tries to keep chunks around CHUNK_TARGET_SIZE chars, never exceeding CHUNK_MAX_SIZE.
 */
export function chunkText(text: string): string[] {
  // Normalize line endings and split into paragraphs
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed max, flush current chunk
    if (
      current.length > 0 &&
      current.length + paragraph.length + 2 > CHUNK_MAX_SIZE
    ) {
      chunks.push(current.trim());
      current = "";
    }

    // If a single paragraph exceeds max, split it by sentences
    if (paragraph.length > CHUNK_MAX_SIZE) {
      if (current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) || [paragraph];
      let sentenceChunk = "";
      for (const sentence of sentences) {
        if (
          sentenceChunk.length > 0 &&
          sentenceChunk.length + sentence.length > CHUNK_MAX_SIZE
        ) {
          chunks.push(sentenceChunk.trim());
          sentenceChunk = "";
        }
        sentenceChunk += sentence;
      }
      if (sentenceChunk.trim()) {
        current = sentenceChunk;
      }
      continue;
    }

    // Accumulate paragraphs
    if (current.length > 0) {
      current += "\n\n" + paragraph;
    } else {
      current = paragraph;
    }

    // Flush if we've hit the target
    if (current.length >= CHUNK_TARGET_SIZE) {
      chunks.push(current.trim());
      current = "";
    }
  }

  // Flush remaining
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Ingest a document into the knowledge base.
 * Splits the content into chunks and stores both the full document and its chunks.
 */
export async function ingestDocument(options: {
  title: string;
  content: string;
  source: "upload" | "url";
  tags?: string;
}): Promise<{ id: string; chunkCount: number }> {
  const chunks = chunkText(options.content);

  const doc = await prisma.knowledgeDocument.create({
    data: {
      title: options.title,
      source: options.source,
      content: options.content,
      chunks: JSON.stringify(chunks),
      tags: options.tags ?? null,
    },
  });

  return { id: doc.id, chunkCount: chunks.length };
}

/**
 * Search the knowledge base for chunks matching a query.
 * Uses case-insensitive substring matching across chunks.
 * Returns the most relevant chunks with their document title and tags.
 */
export async function searchKnowledge(
  query: string,
  options?: { limit?: number; tags?: string },
): Promise<{ title: string; chunk: string; tags: string | null }[]> {
  const limit = options?.limit ?? 10;
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  // Fetch all documents (or filter by tags)
  const where = options?.tags
    ? { tags: { contains: options.tags } }
    : {};

  const docs = await prisma.knowledgeDocument.findMany({ where });

  // Score each chunk by keyword matches
  const scored: { title: string; chunk: string; tags: string | null; score: number }[] = [];

  for (const doc of docs) {
    const chunks: string[] = JSON.parse(doc.chunks);
    for (const chunk of chunks) {
      const lower = chunk.toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (lower.includes(kw)) score++;
      }
      if (score > 0) {
        scored.push({ title: doc.title, chunk, tags: doc.tags, score });
      }
    }
  }

  // Sort by score descending, return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ title, chunk, tags }) => ({
    title,
    chunk,
    tags,
  }));
}

/**
 * List all documents in the knowledge base.
 */
export async function listDocuments(): Promise<
  { id: string; title: string; source: string; tags: string | null; chunkCount: number; createdAt: Date }[]
> {
  const docs = await prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
  });

  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    tags: doc.tags,
    chunkCount: (JSON.parse(doc.chunks) as string[]).length,
    createdAt: doc.createdAt,
  }));
}

/**
 * Delete a document from the knowledge base.
 */
export async function deleteDocument(id: string): Promise<void> {
  await prisma.knowledgeDocument.delete({ where: { id } });
}
