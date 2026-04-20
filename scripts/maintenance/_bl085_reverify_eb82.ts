/**
 * BL-085 — re-verify EB 82 deletion after waiting through EB's async
 * DELETE queue window. Per BL-078 / docs/emailbison-dedi-api-reference.md
 * :572-589, EB's DELETE returns 200 but the actual deletion may take some
 * seconds. First verify pass happened too fast. Poll for up to 30s.
 */

import { PrismaClient } from "@prisma/client";
import { EmailBisonClient } from "@/lib/emailbison/client";
import { isNotFoundError } from "@/lib/emailbison/errors";

const WORKSPACE_SLUG = "1210-solutions";
const ORPHAN_EB_ID = 82;

async function main() {
  const prisma = new PrismaClient();
  try {
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { slug: WORKSPACE_SLUG },
      select: { apiToken: true },
    });
    const ebClient = new EmailBisonClient(workspace.apiToken!);

    const maxAttempts = 15;
    const delayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await ebClient.getCampaign(ORPHAN_EB_ID);
        console.log(
          `[bl085-reverify] Attempt ${attempt}/${maxAttempts}: EB ${ORPHAN_EB_ID} still exists.`,
        );
      } catch (err) {
        if (isNotFoundError(err)) {
          console.log(
            `[bl085-reverify] Attempt ${attempt}/${maxAttempts}: EB ${ORPHAN_EB_ID} confirmed deleted (not-found).`,
          );

          // Final sanity — list campaigns and confirm 82 is gone from that list too.
          const allEb = await ebClient.getCampaigns();
          const stillInList = allEb.find((c) => c.id === ORPHAN_EB_ID);
          console.log(
            `[bl085-reverify] getCampaigns() returned ${allEb.length} campaigns. EB ${ORPHAN_EB_ID} in list: ${stillInList != null ? "YES" : "no"}.`,
          );
          if (stillInList != null) {
            console.log(JSON.stringify(stillInList, null, 2));
          }
          return;
        }
        console.log(
          `[bl085-reverify] Attempt ${attempt}/${maxAttempts}: non-404 error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    console.warn(
      `[bl085-reverify] Exhausted ${maxAttempts} attempts; EB ${ORPHAN_EB_ID} still appears to exist.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[bl085-reverify] FATAL:", err);
  process.exit(1);
});
