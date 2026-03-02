import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createChannelWithMembers, postMessage } from "@/lib/slack";
import { runResearchAgent } from "@/lib/agents/research";
import { notify } from "@/lib/notify";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { name, senderFullName } = body;
    if (!name || !senderFullName) {
      return NextResponse.json(
        { error: "Company name and sender name are required" },
        { status: 400 },
      );
    }

    const shouldCreateWorkspace = body.createWorkspace !== false;
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
        if (body.notificationEmails) {
          const clientEmails = body.notificationEmails
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
      const notificationEmails = body.notificationEmails
        ? JSON.stringify(
            body.notificationEmails
              .split(",")
              .map((e: string) => e.trim())
              .filter(Boolean),
          )
        : null;

      // Create workspace record
      const workspace = await prisma.workspace.create({
        data: {
          slug,
          name: body.name,
          vertical: body.vertical || null,
          status: "pending_emailbison",
          slackChannelId,
          notificationEmails,
          linkedinUsername: body.linkedinUsername || null,
          linkedinPasswordNote: body.linkedinPasswordNote || null,
          senderFullName: body.senderFullName,
          senderJobTitle: body.senderJobTitle || null,
          senderPhone: body.senderPhone || null,
          senderAddress: body.senderAddress || null,
          icpCountries: body.icpCountries || null,
          icpIndustries: body.icpIndustries || null,
          icpCompanySize: body.icpCompanySize || null,
          icpDecisionMakerTitles: body.icpDecisionMakerTitles || null,
          icpKeywords: body.icpKeywords || null,
          icpExclusionCriteria: body.icpExclusionCriteria || null,
          coreOffers: body.coreOffers || null,
          pricingSalesCycle: body.pricingSalesCycle || null,
          differentiators: body.differentiators || null,
          painPoints: body.painPoints || null,
          caseStudies: body.caseStudies || null,
          leadMagnets: body.leadMagnets || null,
          existingMessaging: body.existingMessaging || null,
          supportingMaterials: body.supportingMaterials || null,
          exclusionList: body.exclusionList || null,
          website: body.website || null,
          senderEmailDomains: body.senderEmailDomains
            ? JSON.stringify(body.senderEmailDomains)
            : null,
          targetVolume: body.targetVolume || null,
          onboardingNotes: body.onboardingNotes || null,
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
            body: JSON.stringify({ name: body.name }),
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
            message: err instanceof Error ? err.message : String(err),
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
    if (body.proposalToken) {
      try {
        await prisma.proposal.updateMany({
          where: { token: body.proposalToken, status: "paid" },
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
    if (body.onboardingInviteToken) {
      try {
        await prisma.onboardingInvite.updateMany({
          where: {
            token: body.onboardingInviteToken,
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
    if (workspaceSlug && body.website) {
      const websiteUrl = body.website.startsWith("http")
        ? body.website
        : `https://${body.website}`;
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
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    return NextResponse.json(
      { error: "Failed to create workspace" },
      { status: 500 },
    );
  }
}
