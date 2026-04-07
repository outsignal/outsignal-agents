# Live Data Rules

## Never report stale data

When reporting any data that changes over time, you MUST query the live source. Never cite values from memory, previous conversations, or cached context.

## Data that MUST be queried live

- **API credits/balances**: AI Ark, Prospeo, Apify, BounceBan, Kitt, FindyMail, Adyntel, EmailGuard — check the provider's API or tell the user to check the dashboard
- **Lead/people counts**: Always run a Prisma query, never cite a number from memory
- **Campaign counts and statuses**: Always query the database
- **Reply counts**: Always query the database
- **Sender status, health, session status**: Always query the database
- **Workspace configuration**: Always query the database
- **Inbox/sender counts**: Always query the database
- **Any numerical data that could have changed**

## Prisma query rules

Before writing ANY Prisma query, you MUST:
1. Read the relevant model from `prisma/schema.prisma` first — never guess field names
2. For channel filters on senders, use `channel: { in: ['linkedin', 'both'] }` — never just `channel: 'linkedin'` (misses dual-channel senders)
3. Verify field names exist in the schema before using them in where/select clauses

Previous violations: queried `{ connected: true }` (field doesn't exist), `{ spfValid: false }` (field doesn't exist), `{ channel: 'linkedin' }` (missed `channel: 'both'` senders showing as LinkedIn in portal).

## How to handle it

1. If you CAN query the live source (DB, API): do it before reporting
2. If you CANNOT query the live source: explicitly say "I can't check live — last known value was X from [date], please verify in the dashboard"
3. NEVER present a remembered number as current fact

## Why

Reporting AI Ark as having ~2,800 credits when the dashboard showed 7.3 led to bad decisions. Memory is for context, patterns, and decisions — NOT for current state data.
