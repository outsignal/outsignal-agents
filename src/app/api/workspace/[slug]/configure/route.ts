import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getWorkspaceBySlug } from "@/lib/workspaces";
import { requireAdminAuth } from "@/lib/require-admin-auth";
import { configureWorkspaceSchema } from "@/lib/validations/workspaces";

// Strip sensitive fields before returning workspace data
function stripSensitiveFields<T extends Record<string, unknown>>(workspace: T): Omit<T, "apiToken" | "linkedinPasswordNote"> {
  const { apiToken, linkedinPasswordNote, ...safe } = workspace as Record<string, unknown>;
  return safe as Omit<T, "apiToken" | "linkedinPasswordNote">;
}

// All updatable workspace fields (excluding id, slug, createdAt, updatedAt)
const ALLOWED_FIELDS = [
  "name",
  "vertical",
  "apiToken",
  "status",
  "slackChannelId",
  "notificationEmails",
  "linkedinUsername",
  "linkedinPasswordNote",
  "senderFullName",
  "senderJobTitle",
  "senderPhone",
  "senderAddress",
  "icpCountries",
  "icpIndustries",
  "icpCompanySize",
  "icpDecisionMakerTitles",
  "icpKeywords",
  "icpExclusionCriteria",
  "coreOffers",
  "pricingSalesCycle",
  "differentiators",
  "painPoints",
  "caseStudies",
  "leadMagnets",
  "existingMessaging",
  "supportingMaterials",
  "exclusionList",
  "website",
  "senderEmailDomains",
  "targetVolume",
  "onboardingNotes",
  "clientEmails",
] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;

  // Try DB first
  const dbWorkspace = await prisma.workspace.findUnique({ where: { slug } });
  if (dbWorkspace) {
    return NextResponse.json(stripSensitiveFields(dbWorkspace));
  }

  // Fall back to env config
  const envWorkspace = await getWorkspaceBySlug(slug);
  if (envWorkspace) {
    return NextResponse.json({
      slug: envWorkspace.slug,
      name: envWorkspace.name,
      vertical: envWorkspace.vertical ?? null,
      status: envWorkspace.status,
      source: "env",
    });
  }

  return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await requireAdminAuth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug } = await params;
  const body = await request.json();
  const parseResult = configureWorkspaceSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
  }
  const validated = parseResult.data;

  // Build update data from allowed fields
  const updateData: Record<string, unknown> = {};
  for (const field of ALLOWED_FIELDS) {
    if (validated[field as keyof typeof validated] !== undefined) {
      if (field === "notificationEmails") {
        updateData[field] = Array.isArray(validated[field as keyof typeof validated])
          ? JSON.stringify(validated[field as keyof typeof validated])
          : validated[field as keyof typeof validated];
      } else if (field === "clientEmails") {
        updateData[field] = Array.isArray(validated[field as keyof typeof validated])
          ? JSON.stringify(validated[field as keyof typeof validated])
          : validated[field as keyof typeof validated];
      } else if (field === "senderEmailDomains") {
        updateData[field] = Array.isArray(validated[field as keyof typeof validated])
          ? JSON.stringify(validated[field as keyof typeof validated])
          : validated[field as keyof typeof validated];
      } else {
        updateData[field] = validated[field as keyof typeof validated];
      }
    }
  }

  // If apiToken is being set, auto-activate
  if (validated.apiToken && !validated.status) {
    updateData.status = "active";
  }

  // Check if DB record exists
  const existing = await prisma.workspace.findUnique({ where: { slug } });

  if (existing) {
    // Update existing record
    const updated = await prisma.workspace.update({
      where: { slug },
      data: updateData,
    });
    return NextResponse.json(stripSensitiveFields(updated));
  }

  // No DB record — upsert: seed from env config then apply updates
  const envWorkspace = await getWorkspaceBySlug(slug);
  if (!envWorkspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const created = await prisma.workspace.create({
    data: {
      slug: envWorkspace.slug,
      name: envWorkspace.name,
      vertical: envWorkspace.vertical ?? null,
      apiToken: envWorkspace.apiToken,
      status: "active",
      ...updateData,
    },
  });

  return NextResponse.json(stripSensitiveFields(created));
}
