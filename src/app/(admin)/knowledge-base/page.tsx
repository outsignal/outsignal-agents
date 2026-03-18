import { prisma } from "@/lib/db";
import { KBTable } from "@/components/knowledge-base/kb-table";

export const metadata = {
  title: "Knowledge Base",
};

export default async function KnowledgeBasePage() {
  const docs = await prisma.knowledgeDocument.findMany({
    select: {
      id: true,
      title: true,
      source: true,
      tags: true,
      createdAt: true,
      _count: { select: { chunksRel: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalChunks = await prisma.knowledgeChunk.count();

  // Derive unique tags from all docs
  const allTags = new Set<string>();
  for (const doc of docs) {
    if (doc.tags) {
      for (const tag of doc.tags.split(",")) {
        const trimmed = tag.trim();
        if (trimmed) allTags.add(trimmed);
      }
    }
  }

  const documents = docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    tags: doc.tags,
    chunkCount: doc._count.chunksRel,
    createdAt: doc.createdAt.toISOString(),
  }));

  const stats = {
    totalDocs: docs.length,
    totalChunks,
    uniqueTags: allTags.size,
    lastIngested: docs[0]?.createdAt.toISOString() ?? null,
  };

  return <KBTable documents={documents} stats={stats} />;
}
