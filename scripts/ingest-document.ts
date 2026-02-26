/**
 * Knowledge Base Ingestion CLI — Add documents to the knowledge base for the Writer Agent.
 *
 * Usage:
 *   npx tsx scripts/ingest-document.ts <file-path> [--title "Doc Title"] [--tags "cold-email,best-practices"]
 *   npx tsx scripts/ingest-document.ts --list
 *   npx tsx scripts/ingest-document.ts --delete <document-id>
 *
 * Supported formats: .txt, .md, .html (text extracted)
 *
 * Examples:
 *   npx tsx scripts/ingest-document.ts docs/cold-email-guide.md --tags "cold-email,sequences"
 *   npx tsx scripts/ingest-document.ts docs/linkedin-playbook.txt --title "LinkedIn Outreach Playbook" --tags "linkedin"
 *   npx tsx scripts/ingest-document.ts --list
 */

import { readFileSync, existsSync } from "fs";
import { basename, extname } from "path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// --- Chunking (duplicated from store.ts since we can't use path aliases in scripts) ---

const CHUNK_TARGET_SIZE = 800;
const CHUNK_MAX_SIZE = 1200;

function chunkText(text: string): string[] {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (
      current.length > 0 &&
      current.length + paragraph.length + 2 > CHUNK_MAX_SIZE
    ) {
      chunks.push(current.trim());
      current = "";
    }

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

    if (current.length > 0) {
      current += "\n\n" + paragraph;
    } else {
      current = paragraph;
    }

    if (current.length >= CHUNK_TARGET_SIZE) {
      chunks.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

// --- HTML to text (basic) ---

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Commands ---

async function listDocuments() {
  const docs = await prisma.knowledgeDocument.findMany({
    orderBy: { createdAt: "desc" },
  });

  if (docs.length === 0) {
    console.log("No documents in knowledge base.");
    return;
  }

  console.log(`\n=== Knowledge Base (${docs.length} document(s)) ===\n`);
  for (const doc of docs) {
    const chunkCount = (JSON.parse(doc.chunks) as string[]).length;
    console.log(`  ${doc.id}`);
    console.log(`    Title: ${doc.title}`);
    console.log(`    Source: ${doc.source}`);
    console.log(`    Tags: ${doc.tags ?? "none"}`);
    console.log(`    Chunks: ${chunkCount}`);
    console.log(`    Content: ${doc.content.length} chars`);
    console.log(`    Created: ${doc.createdAt.toISOString().split("T")[0]}`);
    console.log();
  }
}

async function deleteDocument(id: string) {
  try {
    const doc = await prisma.knowledgeDocument.delete({ where: { id } });
    console.log(`Deleted: "${doc.title}" (${id})`);
  } catch {
    console.error(`Document '${id}' not found.`);
    process.exit(1);
  }
}

async function ingestFile(filePath: string, title?: string, tags?: string) {
  if (!existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  const rawContent = readFileSync(filePath, "utf-8");

  let content: string;
  if (ext === ".html" || ext === ".htm") {
    content = stripHtml(rawContent);
  } else {
    content = rawContent;
  }

  if (content.trim().length === 0) {
    console.error("File is empty after processing.");
    process.exit(1);
  }

  const docTitle = title ?? basename(filePath, ext);
  const chunks = chunkText(content);

  console.log(`\n=== Ingesting Document ===`);
  console.log(`  File: ${filePath}`);
  console.log(`  Title: ${docTitle}`);
  console.log(`  Tags: ${tags ?? "none"}`);
  console.log(`  Content: ${content.length} chars`);
  console.log(`  Chunks: ${chunks.length}`);

  const doc = await prisma.knowledgeDocument.create({
    data: {
      title: docTitle,
      source: "upload",
      content,
      chunks: JSON.stringify(chunks),
      tags: tags ?? null,
    },
  });

  console.log(`\n  Saved: ${doc.id}`);
  console.log(`  Done!\n`);
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      `Usage:
  npx tsx scripts/ingest-document.ts <file-path> [--title "Title"] [--tags "tag1,tag2"]
  npx tsx scripts/ingest-document.ts --list
  npx tsx scripts/ingest-document.ts --delete <id>`,
    );
    process.exit(1);
  }

  try {
    if (args[0] === "--list") {
      await listDocuments();
    } else if (args[0] === "--delete" && args[1]) {
      await deleteDocument(args[1]);
    } else {
      const filePath = args[0];
      let title: string | undefined;
      let tags: string | undefined;

      const titleIdx = args.indexOf("--title");
      if (titleIdx !== -1 && args[titleIdx + 1]) {
        title = args[titleIdx + 1];
      }

      const tagsIdx = args.indexOf("--tags");
      if (tagsIdx !== -1 && args[tagsIdx + 1]) {
        tags = args[tagsIdx + 1];
      }

      await ingestFile(filePath, title, tags);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
