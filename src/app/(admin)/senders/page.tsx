import { redirect } from "next/navigation";

export default function SendersPage() {
  redirect("/deliverability?tab=senders");
}
