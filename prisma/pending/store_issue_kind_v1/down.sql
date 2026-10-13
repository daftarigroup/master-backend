-- Rollback for store_issue_kind_v1. Drops the kind / machine columns of `issue` (their data is lost; MATERIAL rows are unaffected otherwise).
DROP INDEX IF EXISTS issue_kind_idx, issue_machine_idx;
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_machine_kind_needs_machine;
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_work_order_id_fkey;
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_machine_id_fkey;
ALTER TABLE issue DROP CONSTRAINT IF EXISTS issue_issue_kind_check;
ALTER TABLE issue DROP COLUMN IF EXISTS meter_reading;
ALTER TABLE issue DROP COLUMN IF EXISTS work_order_id;
ALTER TABLE issue DROP COLUMN IF EXISTS machine_id;
ALTER TABLE issue DROP COLUMN IF EXISTS issue_kind;
