# fleet_v8_billing_views

Read-only billing views per machine (diesel issued, repair / breakdown jobs, spare parts issued, scheduled maintenance). Views only: no table changes. Column meanings: `md/BILLING_DATA_HANDOVER.md`.

- Apply (local only): `psql -v ON_ERROR_STOP=1 -f migration.sql` after `fleet_v7_repair_parts`.
- Rollback: `down.sql` (nothing is lost).
- RDS: not applied. Rollout order: ..., fleet_v6_store_diesel, fleet_v7_repair_parts, **fleet_v8_billing_views**.
