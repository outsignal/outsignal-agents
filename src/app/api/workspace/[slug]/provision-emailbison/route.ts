import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (workspace.apiToken && workspace.status === "active") {
    return NextResponse.json({ error: "Workspace already provisioned" }, { status: 409 });
  }

  const adminToken = process.env.EMAILBISON_ADMIN_TOKEN;
  if (!adminToken) {
    return NextResponse.json({ error: "EmailBison admin token not configured" }, { status: 500 });
  }

  try {
    const ebBase = "https://app.outsignal.ai/api";
    const adminHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
    };

    // 1. Create EmailBison workspace
    const createRes = await fetch(`${ebBase}/workspaces`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: workspace.name }),
    });
    if (!createRes.ok) throw new Error(`EB create workspace: ${createRes.status}`);
    const { data: ebWorkspace } = await createRes.json();

    // 2. Generate API token
    const tokenRes = await fetch(
      `${ebBase}/workspaces/v1.1/${ebWorkspace.id}/api-tokens`,
      {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ name: "outsignal-admin" }),
      },
    );
    if (!tokenRes.ok) throw new Error(`EB create token: ${tokenRes.status}`);
    const { data: tokenData } = await tokenRes.json();

    // 3. Update workspace
    const updated = await prisma.workspace.update({
      where: { slug },
      data: {
        apiToken: tokenData.plain_text_token,
        status: "active",
      },
    });

    notify({
      type: "provisioning",
      severity: "info",
      title: "EmailBison workspace provisioned (manual)",
      workspaceSlug: slug,
      metadata: { emailBisonId: ebWorkspace.id },
    }).catch(() => {});

    return NextResponse.json({
      status: updated.status,
      message: "EmailBison workspace provisioned successfully",
    });
  } catch (err) {
    console.error("[Provision] EmailBison provisioning failed:", err);
    notify({
      type: "provisioning",
      severity: "error",
      title: "Manual EmailBison provisioning failed",
      message: err instanceof Error ? err.message : String(err),
      workspaceSlug: slug,
    }).catch(() => {});

    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provisioning failed" },
      { status: 500 },
    );
  }
}
