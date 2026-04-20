/**
 * BL-105 remediation for Lime Recruitment LinkedIn campaigns C1 and C3.
 *
 * Problem: Adapter does NOT resolve spintax for LinkedIn sequences, so literal
 * `{a|b}` strings were being sent to prospects.
 *
 * Fix: Pick one variant per spintax cluster, rewrite body to plain text,
 * preserve all other step fields (position, type, delayDays, notes) verbatim.
 *
 * Picks driven by PM directive (keep "Do you ever require last minute temp cover"
 * over "Do you use temp cover"), general rule "simpler/longer more-human",
 * and cross-step consistency within a campaign.
 *
 * Only updates linkedinSequence. Does NOT touch emailSequence or any other field.
 */
import { prisma } from '@/lib/db';

type Step = {
  position: number;
  type: string;
  body?: string;
  delayDays: number;
  notes?: string;
};

const C1_ID = 'cmmwei6pf0001zxgpbsvbbsp1';
const C3_ID = 'cmmwei6y80005zxgpptn4wd08';

// ---- C1 rewritten bodies (Manufacturing + Warehousing) ----
const C1_STEP2A_BODY =
  "Hi {FIRSTNAME}, I sent you an email back in {LASTEMAILMONTH} about temp staffing for manufacturing businesses. Thought I'd say hi on here instead. Do you ever require last minute temp cover? Lucy";

const C1_STEP2B_BODY =
  "Hi {FIRSTNAME}, noticed you're in manufacturing in West Yorkshire. Ever get caught short on shift cover? I run Lime Recruitment locally, we arrange vetted temps same day. Worth a chat? Lucy";

const C1_STEP3_BODY =
  "{FIRSTNAME}, Mibelle Group and Printcraft have used us for 15+ years because staff actually turn up. First week's free so you can test us on a real shift. Want more info on how the free week works for manufacturing cover? Lucy";

// ---- C3 rewritten bodies (Transportation + Logistics) ----
const C3_STEP2A_BODY =
  "Hi {FIRSTNAME}, I emailed you back in {LASTEMAILMONTH} about temp staffing for transport companies. Thought I'd reach out here instead. We arrange vetted drivers and warehouse staff same day when you're short. Do you ever need last-minute temp cover? Lucy";

const C3_STEP2B_BODY =
  "Hi {FIRSTNAME}, noticed you're in transport in West Yorkshire. Do driver shortages ever mess up your schedules? I run Lime Recruitment locally. We arrange vetted temps same day. Is that something you'd find useful? Lucy";

const C3_STEP3_BODY =
  "Hi {FIRSTNAME}, most transport companies we work with get caught out by last minute no shows. We've helped Mibelle and Printcraft for 15+ years. First week's free for new clients. Want to hear how the free week works for transport cover? Lucy";

function assertNoSpintax(body: string, label: string): void {
  if (/[{][^}]*[|][^}]*[}]/.test(body)) {
    throw new Error(`spintax still present in ${label}: ${body}`);
  }
  if (body.includes('—') || body.includes('–')) {
    throw new Error(`em/en dash in ${label}: ${body}`);
  }
  if (/\s-\s/.test(body)) {
    throw new Error(`hyphen separator in ${label}: ${body}`);
  }
}

function rewriteSequence(
  raw: string,
  newBodies: Record<string, string>,
  campaignLabel: string,
): { updated: Step[]; diffs: string[] } {
  const steps: Step[] = JSON.parse(raw);
  const diffs: string[] = [];

  // There are TWO step-2 entries in each sequence. We need to map them to
  // variants A and B by order of appearance (which matches the stored order).
  let step2Index = 0;
  const updated: Step[] = steps.map((step) => {
    if (step.position === 2 && step.type === 'message') {
      const key = step2Index === 0 ? 'step2a' : 'step2b';
      step2Index += 1;
      const newBody = newBodies[key];
      if (!newBody) {
        throw new Error(`missing ${key} body for ${campaignLabel}`);
      }
      const oldBody = step.body ?? '';
      assertNoSpintax(newBody, `${campaignLabel} ${key}`);
      diffs.push(
        `\n--- ${campaignLabel} step ${step.position} (${key}) BEFORE ---\n${oldBody}\n--- AFTER ---\n${newBody}\n`,
      );
      return { ...step, body: newBody };
    }
    if (step.position === 3 && step.type === 'message') {
      const newBody = newBodies.step3;
      const oldBody = step.body ?? '';
      assertNoSpintax(newBody, `${campaignLabel} step3`);
      diffs.push(
        `\n--- ${campaignLabel} step 3 BEFORE ---\n${oldBody}\n--- AFTER ---\n${newBody}\n`,
      );
      return { ...step, body: newBody };
    }
    // Step 0 (profile_view) and step 1 (connection_request) are untouched
    return step;
  });

  return { updated, diffs };
}

async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');

  const targets = [
    {
      id: C1_ID,
      label: 'C1-Manufacturing',
      bodies: {
        step2a: C1_STEP2A_BODY,
        step2b: C1_STEP2B_BODY,
        step3: C1_STEP3_BODY,
      },
    },
    {
      id: C3_ID,
      label: 'C3-TransportLogistics',
      bodies: {
        step2a: C3_STEP2A_BODY,
        step2b: C3_STEP2B_BODY,
        step3: C3_STEP3_BODY,
      },
    },
  ];

  for (const t of targets) {
    const c = await prisma.campaign.findUnique({
      where: { id: t.id },
      select: {
        id: true,
        name: true,
        status: true,
        linkedinSequence: true,
        updatedAt: true,
      },
    });
    if (!c) throw new Error(`campaign ${t.id} not found`);
    if (!c.linkedinSequence) throw new Error(`campaign ${t.id} has no linkedinSequence`);

    console.log(`\n==========================================================`);
    console.log(`Campaign: ${c.name}`);
    console.log(`ID: ${c.id}`);
    console.log(`Status: ${c.status}`);
    console.log(`UpdatedAt (before): ${c.updatedAt.toISOString()}`);

    const { updated, diffs } = rewriteSequence(c.linkedinSequence, t.bodies, t.label);
    for (const d of diffs) console.log(d);

    const newJson = JSON.stringify(updated);

    // Defense-in-depth: reject if any spintax remains in serialised JSON
    if (/[{][^}]*[|][^}]*[}]/.test(newJson)) {
      throw new Error(`spintax cluster still detected in serialised JSON for ${t.label}`);
    }

    if (!APPLY) {
      console.log(`\n[DRY-RUN] Would write ${newJson.length} chars of linkedinSequence to ${t.id}`);
      continue;
    }

    const after = await prisma.campaign.update({
      where: { id: t.id },
      data: { linkedinSequence: newJson },
      select: { id: true, updatedAt: true, linkedinSequence: true },
    });
    console.log(`\n[APPLIED] campaign=${after.id} updatedAt=${after.updatedAt.toISOString()}`);
    console.log(`[APPLIED] linkedinSequence length now ${after.linkedinSequence?.length ?? 0} chars`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
