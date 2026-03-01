/**
 * Worker authentication middleware for LinkedIn API routes.
 * The VPS worker authenticates with a shared secret.
 */
import { NextRequest } from "next/server";

export function verifyWorkerAuth(request: NextRequest): boolean {
  const secret = process.env.WORKER_API_SECRET;
  if (!secret) {
    console.error("WORKER_API_SECRET not configured");
    return false;
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return false;

  const token = authHeader.replace("Bearer ", "");
  return token === secret;
}
