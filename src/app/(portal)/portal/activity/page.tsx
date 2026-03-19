import { getPortalSession } from "@/lib/portal-session";
import { redirect } from "next/navigation";
import { ActivityLog } from "./activity-log";

export default async function ActivityPage() {
  let session;
  try {
    session = await getPortalSession();
  } catch {
    redirect("/portal/login");
  }
  const { workspaceSlug } = session;

  return <ActivityLog workspaceSlug={workspaceSlug} />;
}
