const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const result = await p.workspace.update({
    where: { slug: 'lime-recruitment' },
    data: {
      senderFullName: 'Lucy Marshall',
      senderJobTitle: 'Director',
      senderPhone: '07584 685370',
      senderAddress: '1 Field Street, Bradford, BD1 5BT',
      icpCompanySize: '10–500 employees (ideal: 20–250)',
      icpDecisionMakerTitles: 'Warehouse Manager, Operations Manager, Logistics Manager, Production Manager, Shift Manager, Engineering Manager, HR Manager, Factory Manager, General Manager',
      icpKeywords: 'Temp labour, High-volume recruitment, 24/7 operations, Shift cover, Seasonal peaks, Rapid scaling, Mechanical/electrical maintenance',
      icpExclusionCriteria: 'Existing clients (Mibelle: mibellegroup.com, Printcraft: printcraft.co.uk, Niko Extrusions: nikocoatings.com), Recruitment agencies, Sole traders, Bad debt/credit-risk companies, Competitors',
      icpCountries: 'United Kingdom (Bradford, Leeds, Manchester, West Yorkshire, Greater Manchester)',
      icpIndustries: 'Warehousing, Logistics, Distribution, Manufacturing',
      pricingSalesCycle: 'Standard margin-based temp staffing. £14–£22/hour depending on role, higher for skilled engineering. Sales cycle: often same-day turnaround, typically 1–7 days from first conversation to placing staff.',
      differentiators: 'Speed & reliability, 24/7 availability, 15+ years local experience, Specialist in high-volume labour, Simple flexible terms, Strong reputation in Bradford & Manchester. Competitors: Staffline, TRS, Proman, Major, PMP/Challenge TRG',
      painPoints: '"We can\'t get enough staff to cover shifts." "Workers don\'t turn up." "Quality is inconsistent." "Our agency doesn\'t communicate with us." "We need fast supply — not two weeks later." "The cost of employing staff direct is too high."',
      caseStudies: 'Lucy has supplied 2 major employers in Bradford (Mibelle & Printcraft) for over 15+ years. Long-term repeat business due to reliability. 100%+ fulfilment rates.',
      leadMagnets: 'First temp supplied for 1 week FREE OF CHARGE',
      existingMessaging: null,
      supportingMaterials: null,
      exclusionList: 'Existing clients: Mibelle, Printcraft, Niko Extrusions. Bad debt/credit-risk companies. Competitors. Recruitment agencies.',
      coreOffers: '1. High-volume temporary staffing (warehouse, logistics, engineering, manufacturing)\n2. 24/7 out-of-hours service\n3. Fast-response labour (often same day)',
      notificationEmails: JSON.stringify(['jamie@limerec.co.uk', 'lucy@limerec.co.uk']),
      clientEmails: JSON.stringify(['jamie@limerec.co.uk', 'lucy@limerec.co.uk']),
    }
  });
  console.log('Updated workspace:', result.slug);
  console.log('senderFullName:', result.senderFullName);
  console.log('senderJobTitle:', result.senderJobTitle);
  console.log('senderPhone:', result.senderPhone);
  console.log('icpCountries:', result.icpCountries);
  console.log('icpIndustries:', result.icpIndustries);
  console.log('notificationEmails:', result.notificationEmails);
  console.log('clientEmails:', result.clientEmails);
  console.log('coreOffers:', result.coreOffers);
  console.log('\nAll fields updated successfully.');
})().then(() => p.$disconnect());
