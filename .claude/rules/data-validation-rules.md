# Data Validation Rules

## Query the live system before building anything

Before writing ANY code that interacts with the system -- whether it's a new feature, bug fix, migration, refactor, or workspace operation -- query the live system first to understand how it actually works. Never guess or assume data values, field names, action types, status strings, or data shapes.

## Mandatory pre-checks

- **Before writing Prisma queries**: Read the schema AND query actual data values. Field names change, models get renamed, and assumptions rot.
- **Before matching on string values** (action types, statuses, event names): Run `SELECT DISTINCT` (or Prisma `groupBy`) to see what values actually exist in production. Code that matches on `"connect"` when the data says `"connection_request"` is silently broken.
- **Before writing migrations**: Query the data that will be migrated to confirm its shape and values. A migration that assumes a field contains X when it actually contains Y will corrupt data or silently skip everything.
- **Before building features that filter/match data**: Verify the filter values exist in production. If your code filters on `status: "active"` but the actual values are `"deployed"`, you get zero results and no error.
- **Before any Nova workspace operation**: Run client sweep, verify current state. Never operate on stale assumptions about a workspace's configuration.

## Red flags that demand investigation

- **A migration dry-run returns "nothing to do"**: This is a RED FLAG, not a green light. It likely means your match conditions are wrong, not that the migration is unnecessary. Query the data directly to confirm.
- **A query returns zero results when you expected results**: Stop and investigate before proceeding. Check the actual values in the database against your filter conditions.
- **A filter matches far fewer records than expected**: Compare your filter values against the distinct values in the column. You may be matching on an old or incorrect string.

## This applies to ALL agents

Both Nova agents (campaign operations) and Monty agents (platform engineering) must follow these rules. The bug that prompted this rule -- matching on `"connect"` instead of `"connection_request"` -- affected campaign deployment, signal pipeline, and migration scripts simultaneously because none of them queried the actual data first.
