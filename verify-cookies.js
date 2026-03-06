const { PrismaClient } = require('@prisma/client');
const { decrypt } = require('./src/lib/crypto');
const p = new PrismaClient();

(async () => {
  const sender = await p.sender.findFirst({ select: { id: true, sessionData: true } });
  if (!sender || !sender.sessionData) {
    console.log('No session data');
    return;
  }
  const decrypted = decrypt(sender.sessionData);
  const parsed = JSON.parse(decrypted);
  console.log('Type:', Array.isArray(parsed) ? 'browser array' : typeof parsed);
  console.log('Count:', Array.isArray(parsed) ? parsed.length : 'N/A');
  if (Array.isArray(parsed)) {
    const names = parsed.map(c => c.name);
    console.log('Cookie names:', names.join(', '));
    console.log('Has li_at:', names.includes('li_at'));
    console.log('Has JSESSIONID:', names.includes('JSESSIONID'));
    const liAt = parsed.find(c => c.name === 'li_at');
    const jsession = parsed.find(c => c.name === 'JSESSIONID');
    console.log('li_at value length:', liAt ? liAt.value.length : 0);
    console.log('JSESSIONID value length:', jsession ? jsession.value.length : 0);
  }
})().then(() => p.$disconnect());
