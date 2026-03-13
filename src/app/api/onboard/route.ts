import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createChannelWithMembers, postMessage } from "@/lib/slack";
import { runResearchAgent } from "@/lib/agents/research";
import { notify } from "@/lib/notify";
import { parseJsonBody } from "@/lib/parse-json";
import {
  verifyAdminSession,
  ADMIN_COOKIE_NAME,
} from "@/lib/admin-auth";
import { onboardSchema } from "@/lib/validations/onboarding";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(request: NextRequest) {
  try {
    // Admin session validation
    const cookie = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!cookie || !verifyAdminSession(cookie)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await parseJsonBody(request);
    if (body instanceof Response) return body;
    const parseResult = onboardSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json({ error: "Validation failed", details: parseResult.error.flatten().fieldErrors }, { status: 400 });
    }

    const { name, senderFullName } = parseResult.data;

    const shouldCreateWorkspace = parseResult.data.createWorkspace !== false;
    let workspaceSlug: string | null = null;
    let workspaceStatus = "pending_emailbison";

    if (shouldCreateWorkspace) {
      const slug = slugify(name);

      // Check for duplicate
      const existing = await prisma.workspace.findUnique({ where: { slug } });
      if (existing) {
        return NextResponse.json(
          { error: "A workspace with this name already exists" },
          { status: 409 },
        );
      }

      // Create Slack channel and invite admin + client (best-effort)
      let slackChannelId: string | null = null;
      try {
        const channelEmails = ["jonathan@outsignal.ai"];
        if (parseResult.data.notificationEmails) {
          const clientEmails = parseResult.data.notificationEmails
            .split(",")
            .map((e: string) => e.trim())
            .filter(Boolean);
          channelEmails.push(...clientEmails);
        }
        slackChannelId = await createChannelWithMembers(
          `client-${slug}`,
          channelEmails,
        );
      } catch (err) {
        console.error("Failed to create Slack channel:", err);
      }

      // Parse notification emails
      const notificationEmails = parseResult.data.notificationEmails
        ? JSON.stringify(
            parseResult.data.notificationEmails
              .split(",")
              .map((e: string) => e.trim())
              .filter(Boolean),
          )
        : null;

      // Create workspace record
      const workspace = await prisma.workspace.create({
        data: {
          slug,
          name: parseResult.data.name,
          vertical: parseResult.data.vertical || null,
          status: "pending_emailbison",
          slackChannelId,
          notificationEmails,
          linkedinUsername: parseResult.data.linkedinUsername || null,
          linkedinPasswordNote: parseResult.data.linkedinPasswordNote || null,
          senderFullName: parseResult.data.senderFullName,
          senderJobTitle: parseResult.data.senderJobTitle || null,
          senderPhone: parseResult.data.senderPhone || null,
          senderAddress: parseResult.data.senderAddress || null,
          icpCountries: parseResult.data.icpCountries || null,
          icpIndustries: parseResult.data.icpIndustries || null,
          icpCompanySize: parseResult.data.icpCompanySize || null,
          icpDecisionMakerTitles: parseResult.data.icpDecisionMakerTitles || null,
          icpKeywords: parseResult.data.icpKeywords || null,
          icpExclusionCriteria: parseResult.data.icpExclusionCriteria || null,
          coreOffers: parseResult.data.coreOffers || null,
          pricingSalesCycle: parseResult.data.pricingSalesCycle || null,
          differentiators: parseResult.data.differentiators || null,
          painPoints: parseResult.data.painPoints || null,
          caseStudies: parseResult.data.caseStudies || null,
          leadMagnets: parseResult.data.leadMagnets || null,
          existingMessaging: parseResult.data.existingMessaging || null,
          supportingMaterials: parseResult.data.supportingMaterials || null,
          exclusionList: parseResult.data.exclusionList || null,
          website: parseResult.data.website || null,
          senderEmailDomains: parseResult.data.senderEmailDomains
            ? JSON.stringify(parseResult.data.senderEmailDomains)
            : null,
          targetVolume: parseResult.data.targetVolume || null,
          onboardingNotes: parseResult.data.onboardingNotes || null,
          clientEmails: notificationEmails,
        },
      });

      workspaceSlug = workspace.slug;

      // Best-effort: Auto-provision EmailBison workspace + API token
      if (process.env.EMAILBISON_ADMIN_TOKEN) {
        try {
          const ebBase = "https://app.outsignal.ai/api";
          const adminHeaders = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.EMAILBISON_ADMIN_TOKEN}`,
          };

          // 1. Create EmailBison workspace
          const createRes = await fetch(`${ebBase}/workspaces`, {
            method: "POST",
            headers: adminHeaders,
            body: JSON.stringify({ name: parseResult.data.name }),
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

          // 3. Store token and activate workspace
          await prisma.workspace.update({
            where: { slug },
            data: {
              apiToken: tokenData.plain_text_token,
              status: "active",
            },
          });
          workspaceStatus = "active";
          console.log(`[Onboard] EmailBison workspace provisioned for ${slug} (EB id: ${ebWorkspace.id})`);
          notify({
            type: "provisioning",
            severity: "info",
            title: "EmailBison workspace provisioned",
            workspaceSlug: slug,
            metadata: { emailBisonId: ebWorkspace.id },
          }).catch(() => {});
        } catch (err) {
          console.error("[Onboard] EmailBison provisioning failed (non-blocking):", err);
          notify({
            type: "provisioning",
            severity: "error",
            title: "EmailBison provisioning failed",
            message: "EmailBison provisioning failed — check server logs",
            workspaceSlug: slug,
          }).catch(() => {});
        }
      }

      // Post welcome message to Slack channel
      if (slackChannelId) {
        try {
          await postMessage(
            slackChannelId,
            `New client onboarded: *${workspace.name}*\nVertical: ${workspace.vertical ?? "N/A"}\nSender: ${workspace.senderFullName}\nStatus: ${workspaceStatus === "active" ? "Active (EmailBison provisioned)" : "Pending Email Bison setup"}`,
          );
        } catch {
          // Non-critical
        }
      }

      notify({
        type: "onboard",
        severity: "info",
        title: `New client onboarded: ${name}`,
        workspaceSlug: slug,
        metadata: { status: workspaceStatus },
      }).catch(() => {});
    }

    // If submitted from a proposal, update the proposal status
    if (parseResult.data.proposalToken) {
      try {
        await prisma.proposal.updateMany({
          where: { token: parseResult.data.proposalToken, status: "paid" },
          data: {
            status: "onboarding_complete",
            ...(workspaceSlug ? { workspaceSlug } : {}),
          },
        });
      } catch {
        // Non-critical
      }
    }

    // If submitted from an onboarding invite, update the invite status
    if (parseResult.data.onboardingInviteToken) {
      try {
        await prisma.onboardingInvite.updateMany({
          where: {
            token: parseResult.data.onboardingInviteToken,
            status: { not: "completed" },
          },
          data: {
            status: "completed",
            ...(workspaceSlug ? { workspaceSlug } : {}),
          },
        });
      } catch {
        // Non-critical
      }
    }

    // Fire-and-forget: Research Agent analyzes the client's website
    if (workspaceSlug && parseResult.data.website) {
      const websiteUrl = parseResult.data.website.startsWith("http")
        ? parseResult.data.website
        : `https://${parseResult.data.website}`;
      runResearchAgent({
        workspaceSlug,
        url: websiteUrl,
        task: "Analyze this client's website and extract ICP, USPs, case studies, and value propositions. Update the workspace with any fields that are currently empty.",
      }).catch((err) =>
        console.error("Post-onboard website analysis failed:", err),
      );
    }

    return NextResponse.json({
      slug: workspaceSlug,
      status: shouldCreateWorkspace ? workspaceStatus : "info_collected",
    });
  } catch (error) {
    console.error("Onboarding error:", error);
    notify({
      type: "error",
      severity: "error",
      title: "Onboarding failed",
      message: "Onboarding failed — check server logs",
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to create workspace" },
      { status: 500 },
    );
  }
}
