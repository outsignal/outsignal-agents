import { ListDetailPage } from "@/components/search/list-detail-page";

export const dynamic = "force-dynamic";

interface ListDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ListDetailRoute({
  params,
}: ListDetailPageProps) {
  const { id } = await params;
  return <ListDetailPage listId={id} />;
}
