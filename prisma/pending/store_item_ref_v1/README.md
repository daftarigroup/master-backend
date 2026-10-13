# store_item_ref_v1

Decision D1 (2026-10-07): Store transactions reference the item master by id, not only by `product_name` text.

- Adds nullable `item_id` (FK `item.id`, `ON DELETE SET NULL`) to `issue`, `store_in`, `store_in_direct`, `indent`, `inventory`, `stock_transfers`, `po_master`, plus `(firm_id, item_id)` indexes. `po_master` already had `firm_id`.
- Nothing is backfilled by the migration. Existing rows keep `item_id = NULL` and `product_name` / `item_name` stay as display text, so nothing breaks.
- Applied to the **local `master_db` only** (backup: `backups_store_item_v1/master_db_before_item_ref.dump`).
  Apply elsewhere with `psql -v ON_ERROR_STOP=1 -f prisma/pending/store_item_ref_v1/migration.sql`, then `npm run prisma:generate`. RDS order: v1, v2, v3, v4, v5, v5b, store_item_ref_v1.
- Rollback: `down.sql` (drops the column and its data).

## Backfill
1. Read-only report: `npx tsx scripts/item_link_diagnostic.ts` (refuses non-local hosts). Matching key: `(firm, lower(trim(collapse spaces(name))))`; firm = `firm_id`, else the firm whose name matches `firm_name` / `firm_name_match`.
2. Write step: `scripts/item_link_backfill.ts` (dry run by default, `--apply` to write; re-runnable, only touches rows with `item_id IS NULL`).

## Later (after the backfill is accepted)
- Unique `(firm_id, lower(trim(item_name)))` on `item` and unique `(firm_id, item_id)` on `inventory`: both need the duplicates resolved first.
