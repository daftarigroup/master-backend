-- store_item_ref_v1: a stable reference to the item master on the Store transaction tables (decision D1, 2026-10-07).
-- Additive and idempotent: only nullable columns, FKs (ON DELETE SET NULL) and indexes. No data is changed and nothing is dropped.
-- The columns stay NULL until the backfill (see README.md); `product_name` / `item_name` stay as the display text.
-- Rollback: down.sql

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['issue', 'store_in', 'store_in_direct', 'indent', 'inventory', 'stock_transfers', 'po_master'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS item_id BIGINT', t);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_item_id_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE SET NULL ON UPDATE CASCADE', t, t || '_item_id_fkey');
    END IF;
  END LOOP;
END $$;

-- (firm, item) lookups: stock per firm per item, issue forms, the backfill
CREATE INDEX IF NOT EXISTS issue_firm_item_idx ON issue (firm_id, item_id);
CREATE INDEX IF NOT EXISTS store_in_firm_item_idx ON store_in (firm_id, item_id);
CREATE INDEX IF NOT EXISTS store_in_direct_firm_item_idx ON store_in_direct (firm_id, item_id);
CREATE INDEX IF NOT EXISTS indent_firm_item_idx ON indent (firm_id, item_id);
CREATE INDEX IF NOT EXISTS inventory_firm_item_idx ON inventory (firm_id, item_id);
CREATE INDEX IF NOT EXISTS po_master_firm_item_idx ON po_master (firm_id, item_id);
CREATE INDEX IF NOT EXISTS stock_transfers_item_idx ON stock_transfers (item_id);
