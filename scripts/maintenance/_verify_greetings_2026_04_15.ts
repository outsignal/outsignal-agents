import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { prisma } from "@/lib/db";

const targets: Array<{ id: string; label: string; steps: number[] }> = [
  { id: "cmnpwzwi5011sp8itj20w1foq", label: "Lime E2", steps: [1, 2] },
  { id: "cmnpx037s01dcp8itzzilfdfb", label: "Lime E5", steps: [2] },
  { id: "cmneqa5180001p8rkwyrrlkg8", label: "1210 Ind", steps: [2, 3] },
  { id: "cmneqixpv0001p8710bov1fga", label: "1210 Fac", steps: [2, 3] },
];

async function main() {
  for (const t of targets) {
    const c = await prisma.campaign.findUniqueOrThrow({
      where: { id: t.id },
      select: { emailSequence: true, status: true, contentApproved: true },
    });
    const seq = JSON.parse(c.emailSequence as unknown as string) as Array<
      Record<string, unknown>
    >;
    console.log(`\n### ${t.label}  status=${c.status}  contentApproved=${c.contentApproved}`);
    for (const want of t.steps) {
      const step =
        seq.find(
          (s) => (s.position as number) === want || (s.stepNumber as number) === want,
        ) ?? seq.find((s, i) => i === want);
      if (!step) {
        console.log(`  step ${want}: NOT FOUND`);
        continue;
      }
      const body =
        (step.body as string) || (step.bodyText as string) || "(no body)";
      console.log(`  step ${want} body:\n---\n${body}\n---`);
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
