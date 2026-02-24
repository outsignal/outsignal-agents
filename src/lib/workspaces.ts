import { EmailBisonClient } from "./emailbison/client";
import { prisma } from "./db";
import type { Workspace } from "@prisma/client";

export interface WorkspaceConfig {
  slug: string;
  name: string;
  apiToken: string;
  vertical?: string;
  source: "env" | "db";
  status: string;
}

export interface WorkspaceListItem {
  slug: string;
  name: string;
  vertical?: string;
  source: "env" | "db";
  status: string;
  hasApiToken: boolean;
}

interface EnvWorkspace {
  slug: string;
  name: string;
  apiToken: string;
  vertical?: string;
}

function getEnvWorkspaces(): EnvWorkspace[] {
  const raw = process.env.EMAILBISON_WORKSPACES;
  if (!raw) return [];
  try {
    return JSON.parse(raw) as EnvWorkspace[];
  } catch {
    console.error("Failed to parse EMAILBISON_WORKSPACES env var");
    return [];
  }
}

export async function getAllWorkspaces(): Promise<WorkspaceListItem[]> {
  const envWs = getEnvWorkspaces().map((w) => ({
    slug: w.slug,
    name: w.name,
    vertical: w.vertical,
    source: "env" as const,
    status: "active",
    hasApiToken: true,
  }));

  const dbWs = await prisma.workspace.findMany({
    orderBy: { createdAt: "desc" },
  });

  const dbMapped = dbWs
    .filter((w) => !envWs.some((e) => e.slug === w.slug))
    .map((w) => ({
      slug: w.slug,
      name: w.name,
      vertical: w.vertical ?? undefined,
      source: "db" as const,
      status: w.status,
      hasApiToken: !!w.apiToken,
    }));

  return [...envWs, ...dbMapped];
}

export async function getWorkspaceBySlug(
  slug: string,
): Promise<WorkspaceConfig | undefined> {
  // Check env first (fast path, backward compatible)
  const envWs = getEnvWorkspaces().find((w) => w.slug === slug);
  if (envWs) {
    return { ...envWs, source: "env", status: "active" };
  }

  // Fall back to DB
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
  // Check if it's a DB workspace
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

// Synchronous helper for env workspaces only (legacy compat)
export function getWorkspaces(): EnvWorkspace[] {
  return getEnvWorkspaces();
}
