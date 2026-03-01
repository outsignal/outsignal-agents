import { reembedAllDocuments } from "../src/lib/knowledge/store";

async function main() {
  console.log("Re-embedding all knowledge base documents...");
  const result = await reembedAllDocuments();
  console.log(
    `Done: ${result.documentsProcessed} docs, ${result.chunksCreated} chunks`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
