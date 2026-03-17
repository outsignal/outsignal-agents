import { redirect } from "next/navigation";

export default function EmailPage() {
  redirect("/deliverability?tab=email-health");
}
