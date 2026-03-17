import { redirect } from "next/navigation";

export default function OnboardPage() {
  redirect("/clients?tab=onboard");
}
