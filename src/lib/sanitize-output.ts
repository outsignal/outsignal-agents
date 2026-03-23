/**
 * sanitize-output.ts
 *
 * Strips known secret formats from CLI wrapper stdout.
 * Purpose: CVE-2025-59536 credential exposure risk mitigation.
 *
 * Scope: Secrets only (DATABASE_URL, API keys, tokens, passwords).
 * PII (emails, names, workspace slugs) is intentionally preserved —
 * agents need that data to do their job.
 *
 * This is a pure string transformation. It does NOT import dotenv,
 * read .env files, or access process.env.
 */

interface SecretPattern {
  pattern: RegExp;
  type: string;
}

// Pattern order matters: more-specific prefix patterns (sk-ant-) appear before
// generic patterns (sk-) so redaction labels are as precise as possible.
const SECRET_PATTERNS: SecretPattern[] = [
  // Database URLs (assignment form)
  {
    pattern: /DATABASE_URL=\S+/gi,
    type: "DATABASE_URL",
  },
  // PostgreSQL connection strings (bare URL)
  {
    pattern: /postgre(?:s|sql):\/\/[^\s"']+/gi,
    type: "DATABASE_URL",
  },
  // Anthropic API key (specific prefix — must come before generic sk- pattern)
  {
    pattern: /sk-ant-[A-Za-z0-9_-]+/g,
    type: "ANTHROPIC_KEY",
  },
  // OpenAI API key (may contain hyphens e.g. sk-proj-...)
  {
    pattern: /sk-[A-Za-z0-9_-]{20,}/g,
    type: "OPENAI_KEY",
  },
  // Trigger.dev secret key (may contain underscores e.g. tr_dev_...)
  {
    pattern: /tr_[A-Za-z0-9_]{20,}/g,
    type: "TRIGGER_KEY",
  },
  // Resend API key
  {
    pattern: /re_[A-Za-z0-9]{20,}/g,
    type: "RESEND_KEY",
  },
  // Slack bot token
  {
    pattern: /xoxb-[A-Za-z0-9-]+/g,
    type: "SLACK_TOKEN",
  },
  // Vercel Blob read/write token
  {
    pattern: /vercelblob_rw_[A-Za-z0-9]+/g,
    type: "BLOB_TOKEN",
  },
  // Named env var assignments (case-insensitive key names)
  {
    pattern:
      /(ANTHROPIC_API_KEY|OPENAI_API_KEY|TRIGGER_SECRET_KEY|RESEND_API_KEY|EMAILBISON_API_KEY|EMAILGUARD_API_TOKEN|INGEST_WEBHOOK_SECRET|API_SECRET|BLOB_READ_WRITE_TOKEN|SLACK_BOT_TOKEN)=\S+/gi,
    type: "$1",
  },
  // Authorization Bearer tokens
  {
    pattern: /Authorization:\s*Bearer\s+\S+/gi,
    type: "BEARER_TOKEN",
  },
];

/**
 * Strips known secret formats from a string.
 *
 * @param output - The raw string to sanitize (e.g. CLI stdout)
 * @returns The sanitized string with secrets replaced by [REDACTED:type] tokens
 */
export function sanitizeOutput(output: string): string {
  let sanitized = output;

  for (const { pattern, type } of SECRET_PATTERNS) {
    if (type === "$1") {
      // Named env var: capture and use the variable name as the redaction label
      sanitized = sanitized.replace(pattern, (_, varName: string) => {
        return `[REDACTED:${varName.toUpperCase()}]`;
      });
    } else {
      sanitized = sanitized.replace(pattern, `[REDACTED:${type}]`);
    }
  }

  return sanitized;
}
