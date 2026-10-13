# fleet_v3_ops: work logs, service schedules, assignments, transfers, task assignment

Design: [md/WORK_LOGS_MAINTENANCE_ASSIGNMENTS_PHASE1_PLAN.md](../../../../md/WORK_LOGS_MAINTENANCE_ASSIGNMENTS_PHASE1_PLAN.md) section A. Builds on `fleet_v1` and `fleet_v2_cost`.

**Status (2026-10-01): APPLIED to the local `master_db` only (localhost:5432; a custom-format dump taken first is in `backups_ops_v1/db/master_db_before_v3.dump`), `schema.prisma` updated, client regenerated. NOT applied to the AWS RDS database.** Do not point `.env` back at RDS with this client until `fleet_v1`, `fleet_v2_cost` AND `fleet_v3_ops` have all been applied there.

| File | What it is |
|---|---|
| `migration.sql` | Additive, one transaction: 6 enums, 10 new tables (`work_types`, `work_log_status_logs`, `checklist_templates`, `checklist_template_items`, `machine_service_schedules`, `machine_documents`, `machine_assignments`, `machine_operator_assignments`, `machine_transfers`, `machine_transfer_events`), new columns on `machine_usage_logs`, `maintenance_work_orders`, `work_order_checklist_items`, `work_order_repair_parts`, `machines`, `fleet_settings`, `wbs_activities`, CHECK constraints, partial unique indexes, backfill. |
| `down.sql` | Rollback. Drops everything the migration added (the new tables lose their data). Existing columns (`done`, `cost`, `documentUrls`, readings) are never altered, so nothing else is lost. |

## Backfill
- Every existing `machine_usage_logs` row becomes `APPROVED` (history), gets a shift by the 06:00-18:00 IST rule and a `WL-YYYY-NNNNN` number per firm per year; the `WL` counters continue after the highest number.
- Default work types and a "Standard service" checklist template (the 8 items of the design) for every firm that owns machines.
- `Machine.documentUrls` entries become `machine_documents` rows (type guessed from the description; unparseable values kept as plain documents). `documentUrls` stays in place, deprecated. The old screen's invented "standard documents" are not migrated.
- One ACTIVE assignment per live machine that has a firm. **Machines with no firm get none** and show as Available / "no project" until an admin assigns them.
- Work orders with a vendor become `serviceMode = VENDOR`; checklist rows with `done = true` become `state = DONE`.

## Database-only guards (Prisma cannot express them)
`machine_usage_logs`: unique `(firmId, clientRequestId)` and `(firmId, logNumber)` where not null, a rejected log needs a reason. `maintenance_work_orders`: at most one OPEN work order per `scheduleId`. `machine_assignments`: one active assignment per machine. `machine_operator_assignments`: one current operator per machine and shift. `machine_transfers`: one open transfer per machine.

## Verified (scratch PostgreSQL, never RDS)
Apply, rollback and re-apply cleanly; `prisma migrate diff` shows nothing for any object added here (it still reports the ~70 older foreign keys, as for v2); 364 backend tests pass.

## Applying elsewhere (AWS RDS: last step, explicit go-ahead only)
`pg_dump`, dry run on a restored copy, `psql -v ON_ERROR_STOP=1 -f migration.sql`, then `prisma generate`, `tsc`, tests. Rollback: `psql -v ON_ERROR_STOP=1 -f down.sql`, restore `backups_ops_v1/step0/schema.prisma.pre_v3`, `npx prisma generate`.
