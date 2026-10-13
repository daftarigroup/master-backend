# fleet_v6_store_diesel

Phase 2 of the Store x Asset x Maintenance & Repair integration. `diesel_logs` gets `meterReading`, `storeIssueId` (FK `issue.id`, SET NULL; one live log per issue) and `flags`.
Applied to the **local `master_db` only** (backup `backups_store_diesel_v1/master_db_before_v6.dump`).
Elsewhere: `psql -v ON_ERROR_STOP=1 -f prisma/pending/fleet_v6_store_diesel/migration.sql`, then `npm run prisma:generate`.
RDS order: v1, v2, v3, v4, v5, v5b, store_item_ref_v1, store_issue_kind_v1, fleet_v6_store_diesel. Rollback: `down.sql`.
