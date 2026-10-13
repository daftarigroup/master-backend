# fleet_v2_cost: equipment cost tracking

Design: [md/ASSET_EQUIPMENT_COST_PHASE1_PLAN.md](../../../../md/ASSET_EQUIPMENT_COST_PHASE1_PLAN.md) section A. Builds on `fleet_v1`.

**Status (2026-10-01): APPLIED to the local `master_db` only (localhost:5432), `schema.prisma` updated, client regenerated. NOT applied to the AWS RDS database.** The same warning as `fleet_v1` holds: do not point `.env` back at RDS with this client until BOTH `fleet_v1` and `fleet_v2_cost` have been applied there, or Machine/DieselLog/work-order queries will fail on the missing columns.

| File | What it is |
|---|---|
| `migration.sql` | Additive, one transaction: 5 enums, 4 tables (`fleet_settings`, `wbs_activities`, `machine_rates`, `machine_cost_entries`), new columns on `machines`, `machine_usage_logs`, `diesel_logs`, `diesel_receipts`, CHECK constraints, partial indexes, backfill. |
| `down.sql` | Rollback. Drops everything the migration added (the new tables lose their data). |

## Verified (on a scratch PostgreSQL restored from a dump of the local `master_db`, never RDS)
1. `migration.sql` applied cleanly and the backfill created one `fleet_settings` row (the one firm that has machines).
2. `down.sql` returned the schema to a dump identical to the pre-migration one (only pg_dump's random `\restrict` tokens differ).
3. `prisma migrate diff` (database vs `schema.prisma`) reports nothing for any object added here. It does report about 70 foreign keys and a few index renames on older tables (asset/maintenance/repair/HR). That drift existed before this migration (tables created with `db push`).
4. `npx prisma generate`, `tsc --noEmit` and the pure-logic tests pass.

## Decisions baked in
- Historical diesel is NOT priced by the backfill. No receipt price exists and the firm default rate is unset, so `diesel_logs.ratePerLitre/amount/rateSource` stay NULL ("estimated / set rate" on the cost screens). Nothing is invented and nothing is a silent zero.
- `assets.imageUrl` from the plan was dropped: equipment photos come from `machines.imageUrl`.
- The CHECK constraints and the partial indexes exist only in SQL. They are listed in the comment above the new models in `schema.prisma`.
- `updatedAt` on `fleet_settings` and `wbs_activities` has no database default (Prisma's `@updatedAt` supplies it), so raw SQL inserts must provide it.

## Applying it elsewhere (AWS RDS: last step, needs an explicit decision)
Same procedure as `../fleet_v1/README.md`: `pg_dump`, dry run on a restored copy, `psql -v ON_ERROR_STOP=1 -f migration.sql`, then `prisma generate`, `tsc`, tests. Apply `fleet_v1` first if it is not there yet.
Rollback: `psql -v ON_ERROR_STOP=1 -f down.sql`, restore `backups_cost_v1/step1/schema.prisma.pre_v2`, `npx prisma generate`.
