# fleet_v1: owned/rented machines, diesel ledger, usage logbook, work-order columns

Design: [md/FLEET_DIESEL_AND_MAINTENANCE_MERGE_PLAN.md](../../../../md/FLEET_DIESEL_AND_MAINTENANCE_MERGE_PLAN.md) §A.
**Status (2026-09-30): APPLIED to the local `master_db` (promoted to `prisma/migrations/20260930120000_fleet_v1/`, `schema.prisma` replaced, client regenerated). NOT applied to the AWS RDS database.** Do not point `.env` back at RDS with the regenerated client until this migration has been applied there, or existing Machine/Asset/work-order queries will fail on the missing columns.

| File | What it is |
|---|---|
| `migration.sql` | Additive migration: 7 enums, new columns on `machines`, `assets`, `maintenance_work_orders`, 3 new tables, CHECK constraints, partial unique indexes, backfill. One transaction. |
| `down.sql` | Rollback. Drops everything the migration added. |
| `schema.fleet_v1.prisma` | The full Prisma schema after the migration = current `schema.prisma` + the additions. Replaces `schema.prisma` at apply time. |
| `BASE_SCHEMA_SHA256.txt` | Hash of the `schema.prisma` it was built from. If the real file has changed since, rebuild before applying. |

## What was verified (scratch PostgreSQL 18, never RDS)
1. The current schema was built from `schema.prisma` (96 tables) and seeded with rows covering every backfill path.
2. `migration.sql` applied cleanly. Backfill results checked: hired machines (no firm + supplier) became `RENTED` with a trimmed vendor name, their assets followed, `OWNED` otherwise, work orders took their plan's title/description/activity type/document/requester, `firmId` came from the machine, and the outsource state came out `TO_SEND` / `SENT` / `RECEIVED` / `PAID` correctly, with in-house work orders untouched.
3. 31 constraint checks behave as intended: litres > 0, consumer required, `externalRef` unique but many NULLs allowed, no stop < start, no negative usage, usage exists exactly when a stop reading exists, one OPEN entry per machine (a voided one doesn't block), one OPENING receipt per firm, foreign keys, and a machine with diesel history can't be deleted.
4. `down.sql` returned the schema to a dump identical to the pre-migration one.
5. `prisma migrate diff` between the migrated scratch database and `schema.fleet_v1.prisma` is an **empty migration** (zero drift). Prisma ignores the partial unique indexes, so they won't be dropped by a later diff.

The backfill of `maintenance_work_orders."firmId"` from machines is deliberately NOT reverted by `down.sql`: it fills a column that already existed with correct data.

## Why `schema.prisma` has not been edited
`prisma-client-js` generates into the shared `node_modules/.prisma/client`. Prisma selects every scalar column, so a client generated from the new schema would make every existing `Machine`/`Asset`/work-order query ask for columns that the current database does not have, breaking the running app. **The database and the schema must change together.**

## Applying it (do in this order; needs a named target database)
`backend/.env` currently points at an AWS RDS instance that looks like production. Do not run any of this there without a fresh backup and an explicit decision.

1. `pg_dump` a full backup of the target.
2. **Dry run on a copy** (restore the dump into a scratch database, run steps 3-7 there first).
3. `psql -v ON_ERROR_STOP=1 -f migration.sql` against the target. It is one transaction: any error rolls everything back.
4. Confirm `prisma/schema.prisma` still hashes to `BASE_SCHEMA_SHA256.txt` (LF-normalised). If not, rebuild `schema.fleet_v1.prisma` from the current file.
5. Keep a copy of the old file, then replace `prisma/schema.prisma` with `schema.fleet_v1.prisma`.
6. `npx prisma generate`, then `npx tsc --noEmit` and `npm test`.
7. Migration history: this repo's history does not cover the asset, machine, maintenance or repair tables (they were created with `db push`). Plan §A.0 recommends one baseline migration first, and then moving this SQL into `prisma/migrations/<timestamp>_fleet_v1/` so `migrate deploy` owns it. Until that happens, `prisma migrate dev` against this database is not safe either way.

Rollback: `psql -v ON_ERROR_STOP=1 -f down.sql`, restore the old `schema.prisma`, `npx prisma generate`. Take a `pg_dump` first if anything has been entered through the new screens, since the rollback drops those tables.

## Known limits
- CHECK constraints and partial unique indexes exist only in SQL. They are listed in the header comment of the new models in `schema.fleet_v1.prisma`.
- `updatedAt` on `machine_usage_logs` has no database default (Prisma's `@updatedAt` supplies it), so raw SQL inserts must provide it.
- `equipmentType` is `OTHER` and `readingUnit` is `HOURS` for every existing machine until users correct them. Hired machines are found by the old heuristic (no firm + supplier), so review them.
- Existing `daily_machine_logs` rows are not converted. They stay readable as legacy history, and `openingReading = runningHours` already includes their hours.
