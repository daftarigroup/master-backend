# store_issue_kind_v1

Phase 1 of the Store x Asset x Maintenance & Repair integration (`md/STORE_ASSET_MAINTENANCE_INTEGRATION_CHECKLIST.md`).

- `issue.issue_kind` (`MATERIAL` default, `MAINTENANCE`, `ASSET_DIESEL`), `machine_id` (FK `machines.id`, RESTRICT), `work_order_id` (FK `maintenance_work_orders.id`, SET NULL), `meter_reading`. A non-material issue must have a machine (CHECK).
- Existing rows become `MATERIAL`; nothing else changes.
- Applied to the **local `master_db` only** (backup: `backups_store_issue_v1/master_db_before_issue_kind.dump`).
  Elsewhere: `psql -v ON_ERROR_STOP=1 -f prisma/pending/store_issue_kind_v1/migration.sql`, then `npm run prisma:generate`.
  Needs the fleet tables (`machines`, `maintenance_work_orders`), so RDS order: v1, v2, v3, v4, v5, v5b, store_item_ref_v1, store_issue_kind_v1.
- Rollback: `down.sql`.
