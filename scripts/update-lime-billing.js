const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const result = await p.workspace.update({
    where: { slug: 'lime-recruitment' },
    data: {
      billingCompanyName: 'Paytier Solutions Ltd',
      billingAddressLine1: 'Arkwright House, Parsonage Gardens',
      billingCity: 'Manchester',
      billingPostcode: 'M3 2LF',
      invoicePrefix: 'PS',
      billingCycleAnchor: new Date('2025-11-26'),
      billingRenewalDate: new Date('2026-03-26'),
    }
  });
  console.log('Updated billing for:', result.slug);
  console.log('billingCompanyName:', result.billingCompanyName);
  console.log('billingAddressLine1:', result.billingAddressLine1);
  console.log('billingCity:', result.billingCity);
  console.log('billingPostcode:', result.billingPostcode);
  console.log('invoicePrefix:', result.invoicePrefix);
  console.log('billingCycleAnchor:', result.billingCycleAnchor);
  console.log('billingRenewalDate:', result.billingRenewalDate);
})().then(() => p.$disconnect());
