/**
 * member-invite.ts
 *
 * CLI wrapper: invite a member to a workspace and send the magic-link email.
 * Wraps the same logic used by POST /api/workspace/[slug]/members so that
 * Claude Code sub-agents (onboarding flow) can add members without touching
 * the route handler directly.
 *
 * Usage:
 *   node dist/cli/member-invite.js <slug> <email> [role] [--dry-run] [--name "Full Name"]
 *
 *   slug     workspace slug (required)
 *   email    invitee email address (required)
 *   role     one of "owner" | "admin" | "viewer" (default: "viewer")
 *
 * Flags:
 *   --dry-run         preview the action without writing to the DB or sending email
 *   --name "..."      optional display name for the member
 *
 * Output envelope (via runWithHarness): { ok, data: { member, emailSent, dryRun } }
 * Exit codes: 0 on success, 1 on error.
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });

import { runWithHarness } from "./_cli-harness";
import { prisma } from "@/lib/db";
import { createInviteAndSendEmail } from "@/lib/member-invite";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["owner", "admin", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function isValidRole(r: string): r is Role {
  return (VALID_ROLES as readonly string[]).includes(r);
}

// ---------------------------------------------------------------------------
// Arg parsing — positional (slug, email, role) with optional flags
// ---------------------------------------------------------------------------

function parseArgs(): {
  slug: string;
  email: string;
  role: Role;
  name: string | undefined;
  dryRun: boolean;
} {
  const rawArgs = process.argv.slice(2);
  const positional: string[] = [];
  let name: string | undefined;
  let dryRun = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--name") {
      name = rawArgs[++i];
      continue;
    }
    if (a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    }
    positional.push(a);
  }

  const [slug, email, roleRaw] = positional;
  const role = (roleRaw ?? "viewer").trim().toLowerCase();

  if (!slug) throw new Error("Missing required argument: slug");
  if (!email) throw new Error("Missing required argument: email");
  if (!EMAIL_RE.test(email)) throw new Error(`Invalid email address: ${email}`);
  if (!isValidRole(role)) {
    throw new Error(
      `Invalid role '${role}'. Must be one of: ${VALID_ROLES.join(", ")}`,
    );
  }

  return {
    slug,
    email: email.trim().toLowerCase(),
    role,
    name: name?.trim() || undefined,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

runWithHarness(
  "member-invite <slug> <email> [role=viewer] [--dry-run] [--name \"Full Name\"]",
  async () => {
    const { slug, email, role, name, dryRun } = parseArgs();

    const workspace = await prisma.workspace.findUnique({ where: { slug } });
    if (!workspace) throw new Error(`Workspace '${slug}' not found`);

    const existing = await prisma.member.findUnique({
      where: { email_workspaceSlug: { email, workspaceSlug: slug } },
    });
    if (existing) {
      throw new Error(
        `Member ${email} already exists in workspace '${slug}' (status=${existing.status}, role=${existing.role})`,
      );
    }

    if (dryRun) {
      return {
        dryRun: true,
        wouldCreate: {
          email,
          name,
          role,
          workspaceSlug: slug,
          workspaceName: workspace.name,
          status: "invited",
        },
        wouldSendInviteEmail: true,
        emailSent: false,
      };
    }

    const member = await prisma.member.create({
      data: {
        email,
        name,
        role,
        workspaceSlug: slug,
        status: "invited",
        invitedBy: "cli:member-invite",
      },
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      await createInviteAndSendEmail(email, slug, workspace.name);
      emailSent = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : String(err);
      // Mirror the route handler: member row stays, admin can resend.
    }

    return {
      dryRun: false,
      member,
      emailSent,
      emailError,
    };
  },
);
