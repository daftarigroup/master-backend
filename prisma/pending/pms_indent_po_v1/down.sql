-- Rollback of pms_indent_po_v1. Drops only what v1 added; the five tables themselves stay.
-- Fails (and changes nothing) if any pms_po row has indent_id NULL: delete or re-link those POs first.

BEGIN;

ALTER TABLE "pms_po" DROP CONSTRAINT IF EXISTS "pms_po_indent_id_fkey";
ALTER TABLE "pms_po" ALTER COLUMN "indent_id" SET NOT NULL;
ALTER TABLE "pms_po" ADD CONSTRAINT "pms_po_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "pms_indent" DROP CONSTRAINT IF EXISTS "pms_indent_selected_vendor_id_fkey";
ALTER TABLE "pms_indent" DROP COLUMN IF EXISTS "selected_vendor_id";
ALTER TABLE "pms_indent_vendor" DROP COLUMN IF EXISTS "quotation_filename";

DROP INDEX IF EXISTS "pms_indent_stage_idx";
DROP INDEX IF EXISTS "pms_indent_vendor_indent_id_idx";
DROP INDEX IF EXISTS "pms_po_indent_id_idx";

COMMIT;
