import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Workspace } from "@prisma/client";

type RequireWorkspaceResult =
  | { workspace: Workspace; error: null }
  | { workspace: null; error: NextResponse };

/**
 * Validate that a workspace slug is present and corresponds to an existing workspace.
 * Returns the workspace record on success, or a JSON error response on failure.
 *
 * Usage:
 *   const { workspace, error } = await requireWorkspace(searchParams.get("workspace"));
 *   if (error) return error;
 *   // workspace is now typed as Workspace
 */
export async function requireWorkspace(
  slug: string | null | undefined,
): Promise<RequireWorkspaceResult> {
  if (!slug || typeof slug !== "string" || slug.trim() === "") {
    return {
      workspace: null,
      error: NextResponse.json(
        { error: "workspace query parameter is required" },
        { status: 400 },
      ),
    };
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: slug.trim() },
  });

  if (!workspace) {
    return {
      workspace: null,
      error: NextResponse.json(
        { error: `Workspace '${slug}' not found` },
        { status: 404 },
      ),
    };
  }

  return { workspace, error: null };
}
