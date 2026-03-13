import { NextResponse } from "next/server";

/**
 * Safely parse JSON from a request body.
 * Returns the parsed body on success, or a 400 NextResponse on failure.
 *
 * Usage:
 *   const body = await parseJsonBody<MyType>(request);
 *   if (body instanceof Response) return body;
 */
export async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } },
      { status: 400 },
    );
  }
}
