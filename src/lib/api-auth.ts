import { timingSafeEqual } from "crypto";

export function validateApiSecret(req: Request): boolean {
  const secret = process.env.API_SECRET;
  if (!secret) {
    console.warn("[api-auth] API_SECRET not configured — rejecting request");
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
