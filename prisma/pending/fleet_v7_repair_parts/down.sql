-- Rollback for fleet_v7_repair_parts. Drops the part lists and their issue records (data lost) and the work order links.
DROP INDEX IF EXISTS "issue_requirement_idx";
DROP INDEX IF EXISTS "indent_work_order_idx";
ALTER TABLE "issue" DROP CONSTRAINT IF EXISTS "issue_requirement_id_fkey";
ALTER TABLE "indent" DROP CONSTRAINT IF EXISTS "indent_wo_part_id_fkey";
ALTER TABLE "indent" DROP CONSTRAINT IF EXISTS "indent_work_order_id_fkey";
ALTER TABLE "issue" DROP COLUMN IF EXISTS "requirement_id";
ALTER TABLE "indent" DROP COLUMN IF EXISTS "wo_part_id";
ALTER TABLE "indent" DROP COLUMN IF EXISTS "work_order_id";
DROP TABLE IF EXISTS "work_order_part_issues";
DROP TABLE IF EXISTS "work_order_part_requirements";
ALTER TABLE "maintenance_work_orders" DROP COLUMN IF EXISTS "materialRequired";
