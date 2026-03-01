import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { embedText, embedBatch } from "./embeddings";

/**
 * Knowledge base store for cold outbound best practices and reference documents.
 *
 * Documents are split into chunks (~800 chars each, split on paragraph boundaries)
 * and stored in the database. Chunks are embedded with OpenAI text-embedding-3-small
 * and stored in KnowledgeChunk with pgvector for semantic similarity search.
 *
 * Falls back to keyword matching if no KnowledgeChunk records exist yet (pre-migration).
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
 * Also generates vector embeddings for each chunk (requires OPENAI_API_KEY).
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

  // Generate and store vector embeddings for each chunk
  try {
    const embeddings = await embedBatch(chunks);
    for (let i = 0; i < chunks.length; i++) {
      const id = crypto.randomUUID();
      const embedding = embeddings[i];
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeChunk" (id, "documentId", content, embedding, "chunkIndex", "createdAt")
        VALUES (${id}, ${doc.id}, ${chunks[i]}, ${JSON.stringify(embedding)}::vector, ${i}, NOW())
      `;
    }
  } catch (err) {
    // Embedding failure is non-fatal — keyword fallback still works
    console.warn(
      `[store] Warning: failed to embed chunks for "${options.title}":`,
      err instanceof Error ? err.message : err,
    );
  }

  return { id: doc.id, chunkCount: chunks.length };
}

/**
 * Search the knowledge base for chunks matching a query.
 *
 * Primary: pgvector cosine similarity (requires populated KnowledgeChunk table).
 * Fallback: case-insensitive keyword matching on the KnowledgeDocument chunks JSON.
 *
 * Returns the most relevant chunks with their document title and tags.
 */
export async function searchKnowledge(
  query: string,
  options?: { limit?: number; tags?: string },
): Promise<{ title: string; chunk: string; tags: string | null }[]> {
  const limit = options?.limit ?? 10;

  // Check if we have vector chunks (primary path)
  const chunkCount = await prisma.knowledgeChunk.count();

  if (chunkCount > 0) {
    // Semantic search via pgvector cosine similarity
    try {
      const queryEmbedding = await embedText(query);

      type VectorRow = {
        content: string;
        documentId: string;
        title: string;
        tags: string | null;
        similarity: number;
      };

      const results = await prisma.$queryRaw<VectorRow[]>`
        SELECT kc.content, kc."documentId", kd.title, kd.tags,
               1 - (kc.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as similarity
        FROM "KnowledgeChunk" kc
        JOIN "KnowledgeDocument" kd ON kd.id = kc."documentId"
        ${options?.tags ? Prisma.sql`WHERE kd.tags LIKE ${"%" + options.tags + "%"}` : Prisma.empty}
        ORDER BY kc.embedding <=> ${JSON.stringify(queryEmbedding)}::vector
        LIMIT ${limit}
      `;

      return results.map((r) => ({
        title: r.title,
        chunk: r.content,
        tags: r.tags,
      }));
    } catch (err) {
      console.warn(
        "[store] pgvector search failed, falling back to keyword search:",
        err instanceof Error ? err.message : err,
      );
      // Fall through to keyword search below
    }
  }

  // Fallback: keyword matching (used pre-migration or if embedding fails)
  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const where = options?.tags
    ? { tags: { contains: options.tags } }
    : {};

  const docs = await prisma.knowledgeDocument.findMany({ where });

  const scored: {
    title: string;
    chunk: string;
    tags: string | null;
    score: number;
  }[] = [];

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

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ title, chunk, tags }) => ({
    title,
    chunk,
    tags,
  }));
}

/**
 * Re-embed all documents in the knowledge base using the current embedding model.
 * Deletes existing KnowledgeChunk records and regenerates from stored chunks JSON.
 * Use this for one-time migration or when the embedding model changes.
 */
export async function reembedAllDocuments(): Promise<{
  documentsProcessed: number;
  chunksCreated: number;
}> {
  const docs = await prisma.knowledgeDocument.findMany();
  let documentsProcessed = 0;
  let chunksCreated = 0;

  for (const doc of docs) {
    const chunks: string[] = JSON.parse(doc.chunks);

    // Delete existing chunks for this document
    await prisma.knowledgeChunk.deleteMany({
      where: { documentId: doc.id },
    });

    // Generate embeddings in batch
    const embeddings = await embedBatch(chunks);

    // Insert new chunk records with embeddings
    for (let i = 0; i < chunks.length; i++) {
      const id = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO "KnowledgeChunk" (id, "documentId", content, embedding, "chunkIndex", "createdAt")
        VALUES (${id}, ${doc.id}, ${chunks[i]}, ${JSON.stringify(embeddings[i])}::vector, ${i}, NOW())
      `;
      chunksCreated++;
    }

    console.log(`Re-embedded "${doc.title}": ${chunks.length} chunks`);
    documentsProcessed++;
  }

  return { documentsProcessed, chunksCreated };
}

/**
 * List all documents in the knowledge base.
 */
export async function listDocuments(): Promise<
  {
    id: string;
    title: string;
    source: string;
    tags: string | null;
    chunkCount: number;
    createdAt: Date;
  }[]
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
 * KnowledgeChunk records are deleted automatically via CASCADE.
 */
export async function deleteDocument(id: string): Promise<void> {
  await prisma.knowledgeDocument.delete({ where: { id } });
}
