import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Sanity: Campaign count
  const campaignCount = await p.campaign.count();
  console.log('CAMPAIGN_COUNT:', campaignCount);

  // ---- Migration 1: 20260331000000_add_sender_channel ----
  // File: ALTER TABLE "Sender" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'email';
  // + CREATE INDEX "Sender_channel_idx" ON "Sender"("channel");
  const senderChannelCol: any = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'Sender' AND column_name = 'channel';
  `);
  console.log('MIG1_SENDER_CHANNEL_COL:', JSON.stringify(senderChannelCol));
  const senderChannelIdx: any = await p.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'Sender' AND indexname = 'Sender_channel_idx';
  `);
  console.log('MIG1_SENDER_CHANNEL_IDX:', JSON.stringify(senderChannelIdx));

  // ---- Migration 2: 20260331100000_make_person_email_nullable ----
  // File: ALTER TABLE "Lead" ALTER COLUMN "email" DROP NOT NULL;
  const leadEmailCol: any = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'Lead' AND column_name = 'email';
  `);
  console.log('MIG2_LEAD_EMAIL_COL:', JSON.stringify(leadEmailCol));

  // ---- Migration 3: 20260414000000_add_inbox_alert_dedup_timestamps ----
  // File: ADD COLUMN lastCriticalAlertAt/lastNewAlertAt/lastPersistentAlertAt/lastRecentAlertAt/lastStaleAlertAt (all TIMESTAMP(3))
  const inboxCols: any = await p.$queryRawUnsafe(`
    SELECT column_name, data_type, is_nullable, column_default, datetime_precision
    FROM information_schema.columns
    WHERE table_name = 'InboxStatusSnapshot'
      AND column_name IN ('lastCriticalAlertAt','lastNewAlertAt','lastPersistentAlertAt','lastRecentAlertAt','lastStaleAlertAt')
    ORDER BY column_name;
  `);
  console.log('MIG3_INBOX_COLS:', JSON.stringify(inboxCols));

  // ---- Migration 4 (pending): 20260415000000_add_unique_campaign_emailbison_id ----
  // Pre-state: old @@index Campaign_emailBisonCampaignId_idx should EXIST (to be dropped)
  // Post-state: Campaign_emailBisonCampaignId_key unique index should exist (to be created)
  const campaignEbIdxPre: any = await p.$queryRawUnsafe(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'Campaign' AND indexname LIKE '%emailBisonCampaignId%';
  `);
  console.log('MIG4_CAMPAIGN_EB_INDEXES_CURRENT:', JSON.stringify(campaignEbIdxPre));

  // _prisma_migrations inspection
  const pmTable: any = await p.$queryRawUnsafe(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = '_prisma_migrations';
  `);
  console.log('_PRISMA_MIGRATIONS_TABLE_EXISTS:', JSON.stringify(pmTable));
  if (pmTable.length > 0) {
    const pmRows: any = await p.$queryRawUnsafe(`
      SELECT migration_name, started_at, finished_at, rolled_back_at
      FROM _prisma_migrations
      ORDER BY started_at DESC LIMIT 20;
    `);
    console.log('_PRISMA_MIGRATIONS_ROWS:', JSON.stringify(pmRows));
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
