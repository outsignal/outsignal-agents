import { MembersTable } from "@/components/workspace/members-table";

export default async function WorkspaceMembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div>
      <MembersTable slug={slug} />
    </div>
  );
}
