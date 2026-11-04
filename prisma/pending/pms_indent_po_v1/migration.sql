-- pms_indent_po_v1: PMS indent -> PO pipeline (Indent Approval, Vendor Rate Update, Technical Approval, Management Approval,
-- Pending PO, Create PO, PO History). Needs pms_project to exist.
-- Idempotent: creates the five tables when missing, otherwise only adds what is new. Nothing is dropped and no data is changed,
-- except that pms_po.indent_id becomes nullable and its FK becomes ON DELETE SET NULL.
-- Rollback: down.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "pms_indent" (
    "id" SERIAL NOT NULL,
    "indent_number" TEXT NOT NULL,
    "indent_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "project_id" BIGINT NOT NULL,
    "project_name" TEXT NOT NULL,
    "indenter_name" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Pending',
    "indent_approved_at" TIMESTAMP(3),
    "indent_approved_by" TEXT,
    "indent_approval_remarks" TEXT,
    "indent_status" TEXT,
    "vendor_rated_at" TIMESTAMP(3),
    "technical_approved_at" TIMESTAMP(3),
    "technical_approved_by" TEXT,
    "technical_approval_remarks" TEXT,
    "management_approved_at" TIMESTAMP(3),
    "management_approved_by" TEXT,
    "management_approval_remarks" TEXT,
    "approved_vendor_name" TEXT,
    "approved_rate" DECIMAL(15,2),
    "po_required" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pms_indent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pms_indent_item" (
    "id" SERIAL NOT NULL,
    "indent_id" INTEGER NOT NULL,
    "indent_type" TEXT NOT NULL DEFAULT 'Product',
    "group_head" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "approved_quantity" DECIMAL(15,3),
    "current_stock_qty" DECIMAL(15,3) NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL,
    "area_of_use" TEXT NOT NULL,
    "expected_requirement_date" TIMESTAMP(3) NOT NULL,
    "attachment_url" TEXT,
    "specifications" TEXT,
    "equipment_type" TEXT,
    "expected_time" TEXT,
    "day_charge" DECIMAL(15,2),
    CONSTRAINT "pms_indent_item_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pms_indent_vendor" (
    "id" SERIAL NOT NULL,
    "indent_id" INTEGER NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "rate" DECIMAL(15,2) NOT NULL,
    "gst_percent" DECIMAL(5,2) NOT NULL,
    "payment_terms" TEXT,
    "delivery_days" INTEGER,
    "quotation_url" TEXT,
    "rank" INTEGER,
    CONSTRAINT "pms_indent_vendor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pms_po" (
    "id" SERIAL NOT NULL,
    "po_number" TEXT NOT NULL,
    "po_date" TIMESTAMP(3) NOT NULL,
    "indent_id" INTEGER,
    "indent_number" TEXT NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_name" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "vendor_address" TEXT,
    "vendor_gstin" TEXT,
    "vendor_email" TEXT,
    "enquiry_no" TEXT,
    "enquiry_date" TIMESTAMP(3),
    "delivery_date" TIMESTAMP(3),
    "delivery_days" INTEGER,
    "delivery_type" TEXT,
    "destination_address" TEXT,
    "site_engineer_name" TEXT,
    "site_engineer_phone" TEXT,
    "site_engineer_email" TEXT,
    "site_engineer_name_2" TEXT,
    "site_engineer_phone_2" TEXT,
    "site_engineer_email_2" TEXT,
    "contractor_name" TEXT,
    "contractor_phone" TEXT,
    "contractor_email" TEXT,
    "sub_contractor_name" TEXT,
    "sub_contractor_phone" TEXT,
    "sub_contractor_email" TEXT,
    "sub_total" DECIMAL(15,2) NOT NULL,
    "gst_amount" DECIMAL(15,2) NOT NULL,
    "grand_total" DECIMAL(15,2) NOT NULL,
    "terms" JSONB,
    "remarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Issued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pms_po_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pms_po_item" (
    "id" SERIAL NOT NULL,
    "po_id" INTEGER NOT NULL,
    "indent_number" TEXT NOT NULL,
    "quotation_number" TEXT,
    "product_name" TEXT NOT NULL,
    "quantity" DECIMAL(15,3) NOT NULL,
    "uom" TEXT NOT NULL,
    "rate" DECIMAL(15,2) NOT NULL,
    "gst_percent" DECIMAL(5,2) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(15,2) NOT NULL,
    "payment_terms" TEXT,
    CONSTRAINT "pms_po_item_pkey" PRIMARY KEY ("id")
);

-- New columns
ALTER TABLE "pms_indent" ADD COLUMN IF NOT EXISTS "selected_vendor_id" INTEGER;
ALTER TABLE "pms_indent_vendor" ADD COLUMN IF NOT EXISTS "quotation_filename" TEXT;
ALTER TABLE "pms_po" ALTER COLUMN "indent_id" DROP NOT NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS "pms_indent_stage_idx" ON "pms_indent"("stage");
CREATE INDEX IF NOT EXISTS "pms_indent_vendor_indent_id_idx" ON "pms_indent_vendor"("indent_id");
CREATE UNIQUE INDEX IF NOT EXISTS "pms_po_po_number_key" ON "pms_po"("po_number");
CREATE INDEX IF NOT EXISTS "pms_po_indent_id_idx" ON "pms_po"("indent_id");

-- Foreign keys. pms_po_indent_id_fkey is recreated because it used to be ON DELETE RESTRICT.
ALTER TABLE "pms_po" DROP CONSTRAINT IF EXISTS "pms_po_indent_id_fkey";
ALTER TABLE "pms_po" ADD CONSTRAINT "pms_po_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_indent_project_id_fkey') THEN
    ALTER TABLE "pms_indent" ADD CONSTRAINT "pms_indent_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_indent_selected_vendor_id_fkey') THEN
    ALTER TABLE "pms_indent" ADD CONSTRAINT "pms_indent_selected_vendor_id_fkey" FOREIGN KEY ("selected_vendor_id") REFERENCES "pms_indent_vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_indent_item_indent_id_fkey') THEN
    ALTER TABLE "pms_indent_item" ADD CONSTRAINT "pms_indent_item_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_indent_vendor_indent_id_fkey') THEN
    ALTER TABLE "pms_indent_vendor" ADD CONSTRAINT "pms_indent_vendor_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_po_project_id_fkey') THEN
    ALTER TABLE "pms_po" ADD CONSTRAINT "pms_po_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pms_po_item_po_id_fkey') THEN
    ALTER TABLE "pms_po_item" ADD CONSTRAINT "pms_po_item_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "pms_po"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
