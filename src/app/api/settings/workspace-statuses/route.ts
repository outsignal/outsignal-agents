import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { getAllWorkspaces, getWorkspaceBySlug } from "@/lib/workspaces";
import { EmailBisonClient } from "@/lib/emailbison/client";

export async function GET() {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const workspaces = await getAllWorkspaces();
    const results = await Promise.allSettled(
      workspaces.map(async (ws) => {
        if (!ws.hasApiToken) {
          return { ...ws, connected: false };
        }
        const config = await getWorkspaceBySlug(ws.slug);
        if (!config) return { ...ws, connected: false };
        const client = new EmailBisonClient(config.apiToken);
        const connected = await client.testConnection();
        return { ...ws, connected, apiTokenPreview: config.apiToken.slice(0, 8) + "..." };
      }),
    );

    const statuses = results.map((result, i) => {
      if (result.status === "fulfilled") return result.value;
      return { ...workspaces[i], connected: false };
    });

    return NextResponse.json({ workspaces: statuses });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch workspace statuses" },
      { status: 500 },
    );
  }
}
