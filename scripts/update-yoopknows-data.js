const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  // === UPDATE WORKSPACE ===
  const ws = await p.workspace.update({
    where: { slug: 'yoopknows' },
    data: {
      senderFullName: 'Gordon Evans',
      senderJobTitle: 'Architect & Founder',
      senderPhone: '07920 426254',
      senderAddress: 'St Albans, UK',
      targetVolume: '2000',

      // Enriched ICP from onboarding
      icpCountries: 'United Kingdom',
      icpIndustries: 'Architecture (Architects, Architectural Assistants, Architectural Technologists)',
      icpCompanySize: '3-50 employees (sweet spot 5-8 staff)',
      icpDecisionMakerTitles: 'Director, Principal Architect, Practice Owner, Managing Director, Studio Head',
      icpKeywords: 'architecture firm, architectural practice, project management, team collaboration, deadlines, resourcing, work-life balance, team burnout, compliance',
      icpExclusionCriteria: 'Solo practitioners, very large corporate firms over 200 employees',

      // 3 ICP personas
      coreOffers: 'YoopKnows — a lightweight project management platform built by architects, for architects. Helps practices work smarter, collaborate better, and get home on time. Currently offering 6 months free beta access (promo code: FREEFOR6MONTH). Booking link: https://calendly.com/yoopknows/30min',
      pricingSalesCycle: 'SaaS subscription model. Currently in beta — offering 6 months free access to gather feedback. Sales cycle: beta sign-up → product feedback → conversion to paid. Demo/trial approach, not hard-sell.',
      differentiators: '1. Built by architects, for architects — Gordon runs his own practice (Yoop Architects) and built the tool to solve his own team\'s problems. 2. Straightforward and focused — just what you need, no bloat. Unlike ClickUp/Monday.com which are generic US-based tools with overwhelming features. 3. Visually appealing and fun to use — adoption is high because the team actually enjoys using it. 4. Focus on work-life balance — proven to enable practices to work smarter and still get home on time.',
      painPoints: '1. Don\'t know what to do next — everything seems urgent, no clear priorities. 2. Don\'t know who is doing what — lack of team overview. 3. Information overload — difficult to share info consistently, things fall through cracks. 4. Reactive firefighting mentality — always behind, being chased by clients. 5. Team burnout and excessive hours — no work-life balance.',

      caseStudies: 'YoopKnows Vox Pop Testimonials:\n\nSenior Partner: "What I value most is visibility. With a glance I know where every project stands — no need for late-night emails chasing updates."\n\nJunior Architect: "I finally feel like my voice gets heard. Sometimes I know an answer faster than a senior, and that gets picked up straight away."\n\nProject Manager: "Running projects used to feel like spinning plates. Now, it\'s more like watching a well-run orchestra."\n\nParent/Team Member: "The biggest change? I actually get to have dinner with my kids most nights now."\n\nGeneral: "There\'s this calmness in the office now. We all know who\'s doing what, so the stress has gone right down."',
      leadMagnets: '1-minute Loom video overview of the platform. Beta access with 6 months free (promo code: FREEFOR6MONTH). Short operational review call via Calendly.',

      existingMessaging: 'Email sequences (3-step, beta tester angle):\n\nStep 1: "I am an architect building a tool to help practices work smarter and get home on time. Looking for fellow UK architects to test and give feedback, happy to give 6 months access at no cost. Would a 1 min video on how it works be helpful?"\n\nStep 2: "I know running a practice is full on so just reaching back out. We are here to help teams work smarter and still get home on time. Would a 1 min video be helpful to see if it is worth a look?"\n\nStep 3: "We have been speaking with a few UK practices in beta and the early feedback has been encouraging. I\'d love to get your feedback as well. I can send a beta sign up link or a 1 min overview."\n\nLinkedIn sequences (4 variants with A/B, conversational question-led approach).\n\nPerformance (2 campaigns): 2,789 leads contacted, 126 unique replies (4.5% reply rate), 22 interested.',

      supportingMaterials: 'Figma design: https://www.figma.com/design/DdlgAaa0ZKbV5Qxi5tudQx/YOOP\nGordon\'s blog posts on architect burnout and lifestyle\nLinkedIn authority posts from Gordon\nLoom video overview of YoopKnows platform',

      onboardingNotes: 'YoopKnows is a project management platform built by Gordon Evans (architect) at Yoop Architects. Currently in beta — offering 6 months free to gather feedback from UK architecture practices. 3 ICP personas: The Director (top-down, 44-54yo, practice owner), The Player (mid-level architect, 35-45yo), The Influencer (young graduate, values work-life balance). Strategy discussed Nov 2025: beta tester approach, Loom video CTA, short emails under 60 words. Future angle: supporting women in architecture (gender disparity in senior roles). Contact: Gordon Evans, ge@yooparchitects.co.uk / believe@yoopknows.io. CRM: not specified. Domains: yoopknows.com, yoopknows.io.',
      clientEmails: JSON.stringify(['ge@yooparchitects.co.uk', 'believe@yoopknows.io']),

      // AI Prompts
      icpCriteriaPrompt: `Score leads for YoopKnows based on these criteria (each worth 0-20 points, total 0-100):

1. LOCATION (0-20): Must be UK-based. Full marks for England/Wales/Scotland. 0 for outside UK. (US is secondary market for future.)

2. COMPANY TYPE (0-20): Must be an architecture firm or architectural practice. Full marks for practices doing project-based architectural work. Deduct for pure engineering firms, construction companies, or non-architecture design agencies.

3. COMPANY SIZE (0-20): Sweet spot is 3-50 employees, ideal 5-8 staff. Full marks for small-to-medium practices. Deduct for solo practitioners (too small to need team tool) or large corporate firms over 200 employees.

4. DECISION MAKER (0-20): Three ICP personas score differently:
   - The Director (highest value): Director/Principal level, 44-54yo, 6+ years in business, practice owner. Full marks.
   - The Player (good): Key Architect or junior Director, 35-45yo, 10+ years experience. 15 points.
   - The Influencer (useful): Young personality, degree-qualified, values work-life balance. 10 points.
   Deduct for admin, HR, or non-practice roles.

5. PAIN SIGNALS (0-20): Look for signals of: team management challenges, deadline pressure, scaling pains, work-life balance issues, using generic PM tools (Monday, ClickUp, Asana), relying on spreadsheets/whiteboards. Full marks for clear pain signals. Deduct if they already have a well-established architecture-specific tool.

Exclude entirely: Solo practitioners, firms over 200 employees, non-architecture businesses.`,

      outreachTonePrompt: `YoopKnows tone guidelines for all outreach copy:

VOICE: Gordon Evans — a practising architect who built this tool to solve his own team's problems. Speak architect-to-architect, founder-to-founder. Not a software salesman.

TONE: Warm, conversational, genuinely curious. The ask is for feedback, not a sale. Position as a fellow architect seeking input from peers.

KEY PRINCIPLES:
- Lead as an architect, not a software vendor: "I am an architect building a tool" not "We offer a SaaS platform"
- Frame as beta testing / feedback request, not a pitch: "Looking for fellow UK architects to test and give feedback"
- Use the "work smarter and get home on time" message consistently — this is the core emotional hook
- Keep emails extremely short — under 60 words. One clear thought, one clear CTA
- CTA should be low-resistance: "Would a 1 min video be helpful?" or "Would a brief overview be useful?"
- Use Loom video as the bridge — shows Gordon is a real person, not spam
- Never use aggressive sales language or urgency tactics
- Don't over-explain the product — let curiosity drive the conversation
- Reference other practices' feedback to build social proof: "We've been speaking with a few UK practices in beta"
- Offer tangible value: 6 months free access (promo code FREEFOR6MONTH)
- Sign off as "Gordon, Architect" or "Gordon, Founder @ YoopKnows.com" — keep it personal

LINKEDIN: Conversational, question-led messages. Empty connection request. Initial message asks a genuine question about how they manage their practice. Follow-up references what other practices are saying. No pitch in first touch.

STRUCTURE: 3-step email sequences. Step 1: introduce + video CTA. Step 2: gentle follow-up (3-5 days). Step 3: social proof + beta offer.`,

      normalizationPrompt: `YoopKnows normalisation rules for company names and titles:

COMPANY NAMES:
- Architecture practices often have personal names: preserve exactly as styled (e.g., "Foster + Partners", "Zaha Hadid Architects")
- Keep "Architects", "Architecture", "Studio", "Practice", "Associates" suffixes intact
- Preserve "&" vs "and" and "+" as the firm uses them
- Do not abbreviate practice names
- For Ltd/LLP suffixed firms, keep as registered but use trading name in outreach

JOB TITLES:
- Standardise to: "Director", "Principal", "Associate", "Architect", "Founder"
- "Part I / Part II / Part III" are architectural qualifications, not titles — keep as context but use the job title
- "ARB" and "RIBA" are professional registrations — don't include in title normalisation
- Keep compound titles: "Founding Director", "Managing Partner", "Studio Head"

SECTORS:
- Use "architecture practice", "architectural studio", "design practice" — not "company" or "firm" unless that's how they self-describe`
    }
  });
  console.log('Workspace updated:', ws.name);

  // === UPDATE CLIENT RECORD ===
  const client = await p.client.findFirst({ where: { workspaceSlug: 'yoopknows' } });
  const updatedClient = await p.client.update({
    where: { id: client.id },
    data: {
      contactName: 'Gordon Evans',
      contactEmail: 'ge@yooparchitects.co.uk',
      contactPhone: '07920 426254',
      website: 'https://www.yoopknows.com',
      companyOverview: 'YoopKnows is a lightweight project management platform built by architects, for architects. Founded by Gordon Evans of Yoop Architects (St Albans, UK). Helps practices work smarter, collaborate better, and get home on time. Currently in beta — offering 6 months free access to gather feedback from UK architecture practices. Targets small-to-medium firms (3-50 staff, sweet spot 5-8).',
      notes: 'Beta tester outreach approach (not direct sales). Loom video as primary CTA. Short emails under 60 words. Promo code: FREEFOR6MONTH. Future angle: supporting women in architecture. 2 completed email campaigns: 2,789 leads, 126 replies (4.5%), 22 interested. LinkedIn sequences also running (4 variants with A/B). Strategy call notes from Nov 4, 2025 available. Calendly booking: https://calendly.com/yoopknows/30min',
      links: JSON.stringify([
        { label: 'YoopKnows Website', url: 'https://www.yoopknows.com' },
        { label: 'YoopKnows.io', url: 'https://yoopknows.io' },
        { label: 'Calendly Booking', url: 'https://calendly.com/yoopknows/30min' },
        { label: 'Figma Design', url: 'https://www.figma.com/design/DdlgAaa0ZKbV5Qxi5tudQx/YOOP' }
      ])
    }
  });
  console.log('Client updated:', updatedClient.name);
  console.log('  contactName:', updatedClient.contactName);
  console.log('  contactEmail:', updatedClient.contactEmail);

  await p.$disconnect();
})();
