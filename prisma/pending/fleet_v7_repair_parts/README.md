# fleet_v7_repair_parts

Repair work orders list the parts they need; the Store indent is raised from that list; an approved Store issue (kind MAINTENANCE) makes a part "issued"; an in-house repair with `materialRequired = true` cannot complete until every listed part is issued.

- Apply (local only): `psql -v ON_ERROR_STOP=1 -f migration.sql` after `fleet_v6_store_diesel`. Back up first.
- Rollback: `down.sql` (part lists and their issue records are lost).
- RDS: not applied. Rollout order: v1..v5b, store_item_ref_v1 (+backfill), store_issue_kind_v1, fleet_v6_store_diesel, **fleet_v7_repair_parts**.
