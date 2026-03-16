/**
 * Rotate the LINKEDIN_SESSION_KEY encryption key.
 *
 * Decrypts all encrypted fields with the old key, re-encrypts with the new key,
 * and updates every affected record in a single Prisma transaction.
 *
 * Encrypted fields (all on the Sender model, AES-256-GCM):
 *   - linkedinPassword
 *   - totpSecret
 *   - sessionData
 *
 * Usage:
 *   npx tsx scripts/rotate-encryption-key.ts --old-key <hex> --new-key <hex> [--dry-run]
 *
 * Options:
 *   --old-key   Current 64-char hex key (32 bytes)
 *   --new-key   Replacement 64-char hex key (32 bytes)
 *   --dry-run   Decrypt + re-encrypt every field but skip the DB write
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// ---------------------------------------------------------------------------
// Crypto helpers — mirrors src/lib/crypto.ts but accepts an explicit key
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decryptWithKey(encryptedString: string, key: Buffer): string {
  const parts = encryptedString.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted string format");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encrypted = parts[2];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { oldKey: string; newKey: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let oldKey = "";
  let newKey = "";
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--old-key=")) {
      oldKey = arg.split("=")[1];
    } else if (arg === "--old-key" && args[i + 1]) {
      oldKey = args[++i];
    } else if (arg.startsWith("--new-key=")) {
      newKey = arg.split("=")[1];
    } else if (arg === "--new-key" && args[i + 1]) {
      newKey = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    }
  }

  if (!oldKey || !newKey) {
    console.error(
      "Usage: npx tsx scripts/rotate-encryption-key.ts --old-key <hex> --new-key <hex> [--dry-run]"
    );
    process.exit(1);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(oldKey)) {
    console.error("Error: --old-key must be a 64-character hex string (32 bytes)");
    process.exit(1);
  }
  if (!/^[0-9a-fA-F]{64}$/.test(newKey)) {
    console.error("Error: --new-key must be a 64-character hex string (32 bytes)");
    process.exit(1);
  }
  if (oldKey === newKey) {
    console.error("Error: new key must be different from old key");
    process.exit(1);
  }

  return { oldKey, newKey, dryRun };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ENCRYPTED_FIELDS = ["linkedinPassword", "totpSecret", "sessionData"] as const;
type EncryptedField = (typeof ENCRYPTED_FIELDS)[number];

async function main() {
  const { oldKey, newKey, dryRun } = parseArgs();
  const oldKeyBuf = Buffer.from(oldKey, "hex");
  const newKeyBuf = Buffer.from(newKey, "hex");
  const prisma = new PrismaClient();

  if (dryRun) {
    console.log("[DRY RUN] No database writes will be performed.\n");
  }

  try {
    // Fetch all senders that have at least one encrypted field
    const senders = await prisma.sender.findMany({
      where: {
        OR: [
          { linkedinPassword: { not: null } },
          { totpSecret: { not: null } },
          { sessionData: { not: null } },
        ],
      },
      select: {
        id: true,
        name: true,
        linkedinPassword: true,
        totpSecret: true,
        sessionData: true,
      },
    });

    if (senders.length === 0) {
      console.log("No senders with encrypted data found. Nothing to migrate.");
      return;
    }

    console.log(`Found ${senders.length} sender(s) with encrypted data.\n`);

    // Build update operations — decrypt with old key, re-encrypt with new key
    type UpdateOp = { where: { id: string }; data: Record<string, string> };
    const updates: UpdateOp[] = [];
    let totalFields = 0;

    for (let i = 0; i < senders.length; i++) {
      const sender = senders[i];
      const data: Record<string, string> = {};

      for (const field of ENCRYPTED_FIELDS) {
        const value = sender[field];
        if (!value) continue;

        try {
          const plaintext = decryptWithKey(value, oldKeyBuf);
          const reEncrypted = encryptWithKey(plaintext, newKeyBuf);

          // Verify round-trip: decrypt the new ciphertext with the new key
          const verify = decryptWithKey(reEncrypted, newKeyBuf);
          if (verify !== plaintext) {
            console.error(
              `FATAL: Round-trip verification failed for sender "${sender.name}" (${sender.id}), field ${field}`
            );
            process.exit(1);
          }

          data[field] = reEncrypted;
          totalFields++;
        } catch (err) {
          console.error(
            `\nError: Failed to decrypt ${field} for sender "${sender.name}" (${sender.id}).`
          );
          console.error(
            "This likely means --old-key is incorrect or the data is corrupted."
          );
          console.error(`Detail: ${(err as Error).message}`);
          process.exit(1);
        }
      }

      if (Object.keys(data).length > 0) {
        updates.push({ where: { id: sender.id }, data });
      }

      const fields = Object.keys(data).join(", ");
      console.log(
        `  ${dryRun ? "[DRY RUN] " : ""}Migrated sender "${sender.name}" (${i + 1}/${senders.length}) — fields: ${fields}`
      );
    }

    if (dryRun) {
      console.log(
        `\n[DRY RUN] All ${totalFields} encrypted field(s) across ${updates.length} sender(s) decrypted and re-encrypted successfully.`
      );
      console.log("No database changes were made.");
      return;
    }

    // Execute all updates in a single transaction
    console.log(`\nWriting ${updates.length} update(s) in a single transaction...`);

    await prisma.$transaction(
      updates.map((u) => prisma.sender.update(u))
    );

    console.log(
      `\nDone. Rotated ${totalFields} encrypted field(s) across ${updates.length} sender(s).`
    );
    console.log(
      "\nNext steps:"
    );
    console.log("  1. Update LINKEDIN_SESSION_KEY in .env and Vercel env vars to the new key");
    console.log("  2. Redeploy the application");
    console.log("  3. Verify LinkedIn sender operations work correctly");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
