const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const client = await p.client.findFirst({ where: { workspaceSlug: 'lime-recruitment' } });
  const workspace = await p.workspace.findUnique({ where: { slug: 'lime-recruitment' } });

  console.log('=== CLIENT ===');
  if (!client) {
    console.log('No Client record found with workspaceSlug "lime-recruitment"');
  } else {
    for (const [key, value] of Object.entries(client)) {
      const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0);
      console.log(`${empty ? '❌' : '✅'} ${key}: ${JSON.stringify(value)}`);
    }
  }

  console.log('\n=== WORKSPACE ===');
  if (!workspace) {
    console.log('No Workspace record found with slug "lime-recruitment"');
  } else {
    for (const [key, value] of Object.entries(workspace)) {
      const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0);
      console.log(`${empty ? '❌' : '✅'} ${key}: ${JSON.stringify(value)}`);
    }
  }
})().then(() => p.$disconnect());
