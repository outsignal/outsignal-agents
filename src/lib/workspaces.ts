import { EmailBisonClient } from "./emailbison/client";
import { prisma } from "./db";
import type { Workspace } from "@prisma/client";

export interface WorkspaceConfig {
  slug: string;
  name: string;
  apiToken: string;
  vertical?: string;
  source: "db";
  status: string;
}

export interface WorkspaceListItem {
  slug: string;
  name: string;
  vertical?: string;
  source: "db";
  status: string;
  hasApiToken: boolean;
}

export async function getAllWorkspaces(): Promise<WorkspaceListItem[]> {
  try {
    const dbWs = await prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
    });
    return dbWs.map((w) => ({
      slug: w.slug,
      name: w.name,
      vertical: w.vertical ?? undefined,
      source: "db" as const,
      status: w.status,
      hasApiToken: !!w.apiToken,
    }));
  } catch (err) {
    console.error("[workspaces] DB query failed:", err);
    return [];
  }
}

export async function getWorkspaceBySlug(
  slug: string,
): Promise<WorkspaceConfig | undefined> {
  const dbWs = await prisma.workspace.findUnique({ where: { slug } });
  if (!dbWs || !dbWs.apiToken) return undefined;

  return {
    slug: dbWs.slug,
    name: dbWs.name,
    apiToken: dbWs.apiToken,
    vertical: dbWs.vertical ?? undefined,
    source: "db",
    status: dbWs.status,
  };
}

export async function getWorkspaceDetails(
  slug: string,
): Promise<Workspace | null> {
  const dbWs = await prisma.workspace.findUnique({ where: { slug } });
  return dbWs;
}

export async function getClientForWorkspace(
  slug: string,
): Promise<EmailBisonClient> {
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) throw new Error(`Workspace not found: ${slug}`);
  return new EmailBisonClient(workspace.apiToken);
}
