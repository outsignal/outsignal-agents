import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local" });
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { orchestratorConfig, orchestratorTools } from "@/lib/agents/orchestrator";

const campaigns = [
  { name: "Warehouse Manager", id: "cmneheciv0001p8amqe74xtgi", role: "warehouse" },
  { name: "Logistics Manager", id: "cmnehed0a0003p8amvswj7flf", role: "logistics" },
  { name: "Factory Manager", id: "cmnehed3g0005p8am86jfq8a6", role: "factory" },
  { name: "Shift Manager", id: "cmnehed6g0007p8am3s4blrus", role: "shift" },
];

const emailAngles = `
EXISTING EMAIL ANGLES TO ADAPT (shared across all 4 campaigns, only the job role keyword differs):

Angle 1 - Direct opener: Asks who manages temp staffing for the relevant roles. Short, direct.

Angle 2 - Pain + free offer: Lucy works with similar job titles in the area who need short notice temp cover. Free first week offer. Vetted temps on site same or next day, even at 5am. Asks to send a video intro.

Angle 3 - Right person: Introduces Lime Recruitment, offers same/next day cover. Asks if they are the right person or should she reach someone else.

Angle 4 - Social proof: Most people in similar roles came to Lime after being let down by previous agency. Names Mibelle Group and Printcraft (15+ year clients). Staff who turn up, same day cover, 5am phone answering. Free first week offer.

Angle 5 - Short closer: If you ever need last minute temp cover, we are a phone call away. Free week offer still stands.
`;

(async () => {
  for (const campaign of campaigns) {
    console.log(`\n\n========== Writing LinkedIn copy for: ${campaign.name} ==========\n`);

    const userMessage = `Write a LinkedIn sequence for the campaign: LinkedIn - ${campaign.name} (campaignId: ${campaign.id})

${emailAngles}

INSTRUCTIONS:
- Write a LinkedIn sequence: blank connection request (no note) + 2 follow-up messages
- Adapt the strongest email angles for LinkedIn chat format, tailored to the ${campaign.role} role
- NO spintax (LinkedIn is 1-to-1)
- Keep Lucy's friendly, direct, Northern tone
- Under 100 words per message
- Use variables: {FIRSTNAME}, {COMPANYNAME}, {JOBTITLE}
- Save the sequence to the campaign via saveCampaignSequence
- Do NOT use em dashes, en dashes, or hyphens as separators
- Greeting should be "Hey {FIRSTNAME}," or "Hi {FIRSTNAME},"
`;

    const result = await generateText({
      model: anthropic(orchestratorConfig.model),
      system: orchestratorConfig.systemPrompt + "\nCurrent workspace: lime-recruitment\nInterface: CLI (no browser)",
      messages: [{ role: "user", content: userMessage }],
      tools: orchestratorTools,
      stopWhen: stepCountIs(orchestratorConfig.maxSteps ?? 12),
    });

    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        console.log("[Tool]", tc.toolName, JSON.stringify(tc.input || (tc as any).args, null, 2)?.slice(0, 500));
        const tr = step.toolResults.find((r: any) => r.toolCallId === tc.toolCallId);
        if (tr) console.log("[Result]", JSON.stringify((tr as any).output ?? tr, null, 2)?.slice(0, 500));
      }
    }
    console.log("\n---RESPONSE---\n");
    console.log(result.text);
  }
})();
