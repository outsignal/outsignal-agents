import { timingSafeEqual } from "crypto";

export function validateCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[cron-auth] CRON_SECRET not configured — rejecting request");
    return false;
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) return false;

  try {
    const secretBuf = Buffer.from(secret);
    const tokenBuf = Buffer.from(token);
    if (secretBuf.length !== tokenBuf.length) return false;
    return timingSafeEqual(secretBuf, tokenBuf);
  } catch {
    return false;
  }
}
