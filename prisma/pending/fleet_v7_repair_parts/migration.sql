-- fleet_v7_repair_parts: in-house repair work orders list the parts they need, the Store indent is raised from the list,
-- and an approved Store issue is what makes a part "issued" (Phases 5 and 6 of the Store x Asset x M&R integration).
-- Additive and idempotent. Rollback: down.sql
--   maintenance_work_orders.materialRequired   NULL = not decided (old orders), true / false = the in-house "material required?" answer
--   work_order_part_requirements               the parts a repair needs (Store items)
--   work_order_part_issues                     one live row per approved Store issue (issued quantity is always derived from these)
--   indent.work_order_id / wo_part_id          which work order / part line an indent was raised for
--   issue.requirement_id                       which part line a Store issue is against

ALTER TABLE "maintenance_work_orders" ADD COLUMN IF NOT EXISTS "materialRequired" boolean;

CREATE TABLE IF NOT EXISTS "work_order_part_requirements" (
  "id"           text PRIMARY KEY,
  "workOrderId"  text NOT NULL REFERENCES "maintenance_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "firmId"       bigint,
  "itemId"       bigint REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "itemName"     text NOT NULL,
  "groupHead"    text NOT NULL,
  "uom"          text,
  "quantity"     numeric(12, 3) NOT NULL CHECK ("quantity" > 0),
  "note"         text,
  "indentNumber" text,
  "status"       text NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN', 'CANCELLED')),
  "createdById"  bigint,
  "createdAt"    timestamptz(3) NOT NULL DEFAULT now(),
  "cancelledAt"  timestamptz(3),
  "cancelReason" text
);
CREATE INDEX IF NOT EXISTS "work_order_part_requirements_wo_idx" ON "work_order_part_requirements" ("workOrderId");

CREATE TABLE IF NOT EXISTS "work_order_part_issues" (
  "id"            text PRIMARY KEY,
  "requirementId" text NOT NULL REFERENCES "work_order_part_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "workOrderId"   text NOT NULL REFERENCES "maintenance_work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "storeIssueId"  bigint REFERENCES "issue"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "quantity"      numeric(12, 3) NOT NULL,
  "unitCost"      numeric(14, 4),
  "amount"        numeric(14, 2),
  "createdAt"     timestamptz(3) NOT NULL DEFAULT now(),
  "voidedAt"      timestamptz(3),
  "voidReason"    text
);
CREATE INDEX IF NOT EXISTS "work_order_part_issues_wo_idx" ON "work_order_part_issues" ("workOrderId");
CREATE INDEX IF NOT EXISTS "work_order_part_issues_req_idx" ON "work_order_part_issues" ("requirementId");
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_part_issues_one_per_store_issue" ON "work_order_part_issues" ("storeIssueId") WHERE "storeIssueId" IS NOT NULL AND "voidedAt" IS NULL;

ALTER TABLE "indent" ADD COLUMN IF NOT EXISTS "work_order_id" text;
ALTER TABLE "indent" ADD COLUMN IF NOT EXISTS "wo_part_id" text;
ALTER TABLE "issue" ADD COLUMN IF NOT EXISTS "requirement_id" text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indent_work_order_id_fkey') THEN
    ALTER TABLE "indent" ADD CONSTRAINT "indent_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "maintenance_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'indent_wo_part_id_fkey') THEN
    ALTER TABLE "indent" ADD CONSTRAINT "indent_wo_part_id_fkey" FOREIGN KEY ("wo_part_id") REFERENCES "work_order_part_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issue_requirement_id_fkey') THEN
    ALTER TABLE "issue" ADD CONSTRAINT "issue_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "work_order_part_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "indent_work_order_idx" ON "indent" ("work_order_id");
CREATE INDEX IF NOT EXISTS "issue_requirement_idx" ON "issue" ("requirement_id");
