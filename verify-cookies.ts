import { PrismaClient } from '@prisma/client';
import { decrypt } from './src/lib/crypto';

const p = new PrismaClient();

async function main() {
  const sender = await p.sender.findFirst({ select: { id: true, sessionData: true, updatedAt: true } });
  if (!sender || !sender.sessionData) {
    console.log('No session data');
    return;
  }
  console.log('Sender updated:', sender.updatedAt);
  const parsed = JSON.parse(decrypt(sender.sessionData));
  if (Array.isArray(parsed)) {
    const liAt = parsed.find((c: any) => c.name === 'li_at');
    const jsession = parsed.find((c: any) => c.name === 'JSESSIONID');
    console.log('Cookie count:', parsed.length);
    console.log('li_at:', liAt ? liAt.value.length + ' chars' : 'MISSING');
    console.log('JSESSIONID:', jsession ? jsession.value.length + ' chars' : 'MISSING');
    console.log('Bridge OK:', !!(liAt?.value && jsession?.value));
  }
}

main().then(() => p.$disconnect());
