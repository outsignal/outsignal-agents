# Prisma Migrate Engine Investigation — 2026-05-05

## Summary

The Phase 2 manual migration workaround did not corrupt Prisma migration
tracking. The manually inserted `_prisma_migrations` row for
`20260505143000_add_icp_profile_phase2_run_context` matches the local
`migration.sql` checksum exactly.

The bare "Schema engine error" reported during the original Phase 2 deploy did
not reproduce on the same machine and direct Neon host. A later official Prisma
deploy successfully applied the only pending migration,
`20260505160000_add_discovery_rejection_log`, and `prisma migrate status` now
reports the database schema is up to date.

## Commands Run

All database commands used the direct Neon host, not the pooler.

```bash
DATABASE_URL="$DIRECT_URL" npx prisma migrate status
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
DATABASE_URL="$DIRECT_URL" npx prisma migrate status
```

## Findings

- `prisma`, `@prisma/client`, and `@prisma/engines` are all installed at
  `6.19.2`.
- The local Prisma schema engine hash is
  `c2990dca591cba766e3b7ef5d9e8a84796e47ab7`.
- The manual Phase 2 migration row is present in `_prisma_migrations` with
  checksum `259946d05171188e050415e44bd57cfb4437a2b479f8485dc60264f1d0d9dc9f`,
  matching:

```bash
shasum -a 256 prisma/migrations/20260505143000_add_icp_profile_phase2_run_context/migration.sql
```

- Initial `migrate status` exited non-zero only because
  `20260505160000_add_discovery_rejection_log` was pending.
- `npx prisma migrate deploy` then applied
  `20260505160000_add_discovery_rejection_log` successfully through the official
  Prisma engine path.
- Final `migrate status` returned:

```text
Database schema is up to date!
```

- `DiscoveryRejectionLog` exists in prod after the deploy.

## Conclusion

The current production database is not drifted and does not have a checksum
integrity issue from the Phase 2 manual workaround. Future migrations can run
through `npx prisma migrate deploy` on the direct Neon host.

The most likely explanation for the original bare "Schema engine error" is a
transient Neon/schema-engine failure during the larger Phase 2 migration window,
or a failure mode specific to that migration's larger DDL/backfill transaction.
It is not explained by local Prisma package/version mismatch or by an invalid
manual checksum row.

## Remaining Limits

- No staging database URL is configured locally, so this investigation did not
  reproduce against a fresh staging database.
- Neon dashboard event checks for the 2026-05-05 12:00-13:00 UTC failure window
  still require dashboard access.
- The original bare schema-engine stderr/stdout was not available beyond the
  incident notes.

## Operational Rule

Continue running Prisma migrations against the direct Neon host:

```bash
DIRECT_URL="$(node -e "require('dotenv').config(); const url = process.env.DATABASE_URL; if (!url) process.exit(2); console.log(url.replace('-pooler.c-', '.c-'));")"
DATABASE_URL="$DIRECT_URL" npx prisma migrate deploy
```

Use the pooler for application traffic, not migrations.
