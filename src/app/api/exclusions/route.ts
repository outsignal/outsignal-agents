import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { parseJsonBody } from "@/lib/parse-json";
import { rateLimit } from "@/lib/rate-limit";

const exclusionLimiter = rateLimit({ windowMs: 60_000, max: 30 });

// ---------------------------------------------------------------------------
// Auth helper (same pattern as /api/people/enrich)
// ---------------------------------------------------------------------------

function authenticateRequest(
  request: NextRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  const secret = process.env.CLAY_WEBHOOK_SECRET;
  if (!secret) {
    console.warn(
      "[Exclusions] CLAY_WEBHOOK_SECRET not configured — rejecting all requests",
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Webhook authentication not configured" },
        { status: 401 },
      ),
    };
  }

  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      ),
    };
  }

  const apiKeyBuf = Buffer.from(apiKey);
  const secretBuf = Buffer.from(secret);
  if (
    apiKeyBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(apiKeyBuf, secretBuf)
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid or missing API key" },
        { status: 401 },
      ),
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rate-limit helper
// ---------------------------------------------------------------------------

function checkRateLimit(
  request: NextRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const { success } = exclusionLimiter(ip);
  if (!success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      ),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET /api/exclusions?workspace=slug
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const rl = checkRateLimit(request);
    if (!rl.ok) return rl.response;

    const auth = authenticateRequest(request);
    if (!auth.ok) return auth.response;

    const workspace = request.nextUrl.searchParams.get("workspace");
    if (!workspace) {
      return NextResponse.json(
        { error: "workspace query parameter is required" },
        { status: 400 },
      );
    }

    const entries = await prisma.exclusionEntry.findMany({
      where: { workspaceSlug: workspace },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ workspace, count: entries.length, entries });
  } catch (error) {
    console.error("Exclusions GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch exclusions" },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/exclusions
// Body: { workspace, domain, companyName?, reason? }
//   or: { workspace, items: [{ domain, companyName?, reason? }] }
// ---------------------------------------------------------------------------

interface ExclusionItem {
  domain: string;
  companyName?: string;
  company_name?: string;
  reason?: string;
}

export async function POST(request: NextRequest) {
  try {
    const rl = checkRateLimit(request);
    if (!rl.ok) return rl.response;

    const auth = authenticateRequest(request);
    if (!auth.ok) return auth.response;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await parseJsonBody<any>(request);
    if (body instanceof Response) return body;

    const workspace: string | undefined = body.workspace;
    if (!workspace || typeof workspace !== "string") {
      return NextResponse.json(
        { error: "workspace is required" },
        { status: 400 },
      );
    }

    // Validate workspace exists
    const ws = await prisma.workspace.findUnique({
      where: { slug: workspace },
      select: { slug: true },
    });
    if (!ws) {
      return NextResponse.json(
        { error: `Workspace '${workspace}' not found` },
        { status: 404 },
      );
    }

    // Normalize items — single or batch
    let items: ExclusionItem[];
    if (body.items && Array.isArray(body.items)) {
      items = body.items;
    } else if (body.domain) {
      items = [
        {
          domain: body.domain,
          companyName: body.companyName ?? body.company_name,
          reason: body.reason,
        },
      ];
    } else {
      return NextResponse.json(
        { error: "Either 'domain' or 'items' array is required" },
        { status: 400 },
      );
    }

    if (items.length > 500) {
      return NextResponse.json(
        { error: "Batch size exceeds maximum of 500 items" },
        { status: 400 },
      );
    }

    // Upsert each entry
    let created = 0;
    let updated = 0;
    const results: { domain: string; action: "created" | "updated"; error?: string }[] = [];

    for (const item of items) {
      const domain = item.domain?.toLowerCase().trim();
      if (!domain) {
        results.push({ domain: "(missing)", action: "created", error: "domain is required" });
        continue;
      }

      const companyName = item.companyName ?? item.company_name ?? undefined;

      const existing = await prisma.exclusionEntry.findUnique({
        where: { workspaceSlug_domain: { workspaceSlug: workspace, domain } },
      });

      if (existing) {
        // Update if new data provided
        const updateData: Record<string, string> = {};
        if (companyName && companyName !== existing.companyName) {
          updateData.companyName = companyName;
        }
        if (item.reason && item.reason !== existing.reason) {
          updateData.reason = item.reason;
        }

        if (Object.keys(updateData).length > 0) {
          await prisma.exclusionEntry.update({
            where: { id: existing.id },
            data: updateData,
          });
        }

        updated++;
        results.push({ domain, action: "updated" });
      } else {
        await prisma.exclusionEntry.create({
          data: {
            workspaceSlug: workspace,
            domain,
            companyName: companyName ?? null,
            reason: item.reason ?? null,
          },
        });

        created++;
        results.push({ domain, action: "created" });
      }
    }

    return NextResponse.json({ created, updated, results });
  } catch (error) {
    console.error("Exclusions POST error:", error);
    return NextResponse.json(
      { error: "Failed to create exclusion entries" },
      { status: 500 },
    );
  }
}
