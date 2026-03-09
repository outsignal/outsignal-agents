import { prisma } from "@/lib/db";

export interface PageSummary {
  id: string;
  slug: string;
  title: string;
  clientId: string | null;
  clientName: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface PageDetail extends PageSummary {
  content: string;
}

export interface CreatePageParams {
  title: string;
  slug?: string; // auto-generate from title if not provided
  content?: string;
  clientId?: string;
}

export interface UpdatePageParams {
  title?: string;
  slug?: string;
  content?: string;
  clientId?: string | null;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function listPages(filters?: {
  clientId?: string;
  search?: string;
}): Promise<PageSummary[]> {
  const where: Record<string, unknown> = {};
  if (filters?.clientId) where.clientId = filters.clientId;
  if (filters?.search)
    where.title = { contains: filters.search, mode: "insensitive" };

  const pages = await prisma.page.findMany({
    where,
    include: { client: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });

  return pages.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    clientId: p.clientId,
    clientName: p.client?.name ?? null,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
  }));
}

export async function getPage(slug: string): Promise<PageDetail | null> {
  const page = await prisma.page.findUnique({
    where: { slug },
    include: { client: { select: { name: true } } },
  });
  if (!page) return null;
  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    content: page.content,
    clientId: page.clientId,
    clientName: page.client?.name ?? null,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

export async function createPage(
  params: CreatePageParams,
): Promise<PageDetail> {
  let slug = params.slug || slugify(params.title);

  // Ensure slug uniqueness
  const existing = await prisma.page.findUnique({ where: { slug } });
  if (existing) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }

  const page = await prisma.page.create({
    data: {
      title: params.title,
      slug,
      content: params.content ?? "",
      clientId: params.clientId ?? null,
    },
    include: { client: { select: { name: true } } },
  });

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    content: page.content,
    clientId: page.clientId,
    clientName: page.client?.name ?? null,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

export async function updatePage(
  slug: string,
  params: UpdatePageParams,
): Promise<PageDetail> {
  const data: Record<string, unknown> = {};
  if (params.title !== undefined) data.title = params.title;
  if (params.slug !== undefined) data.slug = params.slug;
  if (params.content !== undefined) data.content = params.content;
  if (params.clientId !== undefined) data.clientId = params.clientId;

  const page = await prisma.page.update({
    where: { slug },
    data,
    include: { client: { select: { name: true } } },
  });

  return {
    id: page.id,
    slug: page.slug,
    title: page.title,
    content: page.content,
    clientId: page.clientId,
    clientName: page.client?.name ?? null,
    updatedAt: page.updatedAt,
    createdAt: page.createdAt,
  };
}

export async function deletePage(slug: string): Promise<void> {
  await prisma.page.delete({ where: { slug } });
}
