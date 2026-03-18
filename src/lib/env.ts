/**
 * Environment variable validation.
 *
 * Import this module early (e.g. in proxy.ts / middleware) so that missing
 * critical env vars are caught at startup rather than at request time.
 */

const REQUIRED_VARS = [
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
] as const;

const OPTIONAL_VARS = [
  "CLAY_WEBHOOK_SECRET",
  "EMAILBISON_WEBHOOK_SECRET",
  "EXTENSION_TOKEN_SECRET",
  "WORKER_API_SECRET",
  "EMAILGUARD_API_TOKEN",
] as const;

for (const name of REQUIRED_VARS) {
  if (!process.env[name]) {
    throw new Error(
      `[env] Missing required environment variable: ${name}. The application cannot start without it.`,
    );
  }
}

for (const name of OPTIONAL_VARS) {
  if (!process.env[name]) {
    console.warn(
      `[env] Optional environment variable not set: ${name}. Related functionality may be disabled.`,
    );
  }
}
