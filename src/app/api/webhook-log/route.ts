import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// Event types for filter presets
const ERROR_EVENT_TYPES = ["BOUNCED", "UNSUBSCRIBED", "COMPLAINT"];
const REPLY_EVENT_TYPES = [
  "LEAD_REPLIED",
  "LEAD_INTERESTED",
  "UNTRACKED_REPLY_RECEIVED",
];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const eventType = url.searchParams.get("eventType")?.trim() ?? "";
  const workspace = url.searchParams.get("workspace")?.trim() ?? "";
  const errors = url.searchParams.get("errors") === "true";
  const replies = url.searchParams.get("replies") === "true";
  const hoursParam = url.searchParams.get("hours");
  const hours = hoursParam ? parseInt(hoursParam, 10) : null;
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(100, Math.max(1, limitParam));

  // Build where clause
  const where: Prisma.WebhookEventWhereInput = {};

  // Workspace filter
  if (workspace) {
    where.workspace = workspace;
  }

  // Event type filter (exact match)
  if (eventType) {
    where.eventType = eventType;
  }

  // Error preset — filter to error event types
  if (errors && !eventType) {
    where.eventType = { in: ERROR_EVENT_TYPES };
  }

  // Replies preset — filter to reply event types (if errors not already set)
  if (replies && !errors && !eventType) {
    where.eventType = { in: REPLY_EVENT_TYPES };
  }

  // Both errors and replies together: combine them
  if (errors && replies && !eventType) {
    where.eventType = { in: [...ERROR_EVENT_TYPES, ...REPLY_EVENT_TYPES] };
  }

  // Time range filter
  if (hours && !isNaN(hours)) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    where.receivedAt = { gte: since };
  }

  // Search filter — checks leadEmail OR senderEmail contains
  if (search) {
    where.OR = [
      { leadEmail: { contains: search, mode: "insensitive" } },
      { senderEmail: { contains: search, mode: "insensitive" } },
    ];
  }

  const skip = (page - 1) * limit;

  const [events, total] = await Promise.all([
    prisma.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.webhookEvent.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({ events, total, page, totalPages });
}
