import { timingSafeEqual } from "crypto";

type ApiSecretEnvName = "API_SECRET" | "WORKER_API_SECRET";

export function validateApiSecret(
  req: Request,
  secretEnvNames: ApiSecretEnvName[] = ["API_SECRET"],
): boolean {
  const secrets = secretEnvNames
    .map((name) => ({ name, value: process.env[name] }))
    .filter((entry): entry is { name: ApiSecretEnvName; value: string } => Boolean(entry.value));

  if (secrets.length === 0) {
    console.warn(`[api-auth] ${secretEnvNames.join(" or ")} not configured — rejecting request`);
    return false;
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) return false;

  try {
    const tokenBuf = Buffer.from(token);
    return secrets.some(({ value }) => {
      const secretBuf = Buffer.from(value);
      if (secretBuf.length !== tokenBuf.length) return false;
      return timingSafeEqual(secretBuf, tokenBuf);
    });
  } catch {
    return false;
  }
}
