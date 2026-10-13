-- Rollback for store_item_ref_v1. Drops the item references (the data in them is lost; product_name / item_name are untouched).
DROP INDEX IF EXISTS issue_firm_item_idx, store_in_firm_item_idx, store_in_direct_firm_item_idx, indent_firm_item_idx,
  inventory_firm_item_idx, po_master_firm_item_idx, stock_transfers_item_idx;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['issue', 'store_in', 'store_in_direct', 'indent', 'inventory', 'stock_transfers', 'po_master'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_item_id_fkey');
    EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS item_id', t);
  END LOOP;
END $$;
