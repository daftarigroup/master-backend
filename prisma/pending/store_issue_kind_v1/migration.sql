-- store_issue_kind_v1: a Store issue says what kind it is and, for the machine kinds, which machine / work order it is for.
-- Phase 1 of the Store x Asset x Maintenance & Repair integration. Additive and idempotent. Rollback: down.sql
--   MATERIAL      today's issue to a contractor / site (every existing row)
--   MAINTENANCE   machine parts issued to a machine (and usually a repair work order)      (form built in Phase 5)
--   ASSET_DIESEL  diesel issued to a machine                                              (form built in Phase 2)

ALTER TABLE issue ADD COLUMN IF NOT EXISTS issue_kind text NOT NULL DEFAULT 'MATERIAL';
ALTER TABLE issue ADD COLUMN IF NOT EXISTS machine_id text;
ALTER TABLE issue ADD COLUMN IF NOT EXISTS work_order_id text;
ALTER TABLE issue ADD COLUMN IF NOT EXISTS meter_reading numeric(14, 2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_issue_kind_check') THEN
    ALTER TABLE issue ADD CONSTRAINT issue_issue_kind_check CHECK (issue_kind IN ('MATERIAL', 'MAINTENANCE', 'ASSET_DIESEL'));
  END IF;
  -- a machine can not be deleted while Store issues point at it (same rule as diesel logs and usage logs)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_machine_id_fkey') THEN
    ALTER TABLE issue ADD CONSTRAINT issue_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_work_order_id_fkey') THEN
    ALTER TABLE issue ADD CONSTRAINT issue_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES maintenance_work_orders(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  -- the machine kinds need a machine
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_machine_kind_needs_machine') THEN
    ALTER TABLE issue ADD CONSTRAINT issue_machine_kind_needs_machine CHECK (issue_kind = 'MATERIAL' OR machine_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS issue_kind_idx ON issue (issue_kind);
CREATE INDEX IF NOT EXISTS issue_machine_idx ON issue (machine_id);
