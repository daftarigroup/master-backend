-- Consolidated release migration: PMS module (pms_* tables, user.pms_access), keyset sort indexes,
-- drop of document_sequences firmId FK (0 = 'no firm' sentinel). Generated as a diff vs the 2026-10-23 prod dump.

-- DropForeignKey
ALTER TABLE "document_sequences" DROP CONSTRAINT IF EXISTS "document_sequences_firmId_fkey";

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "pms_access" BOOLEAN DEFAULT false;

-- CreateTable
CREATE TABLE "pms_project" (
    "id" BIGSERIAL NOT NULL,
    "serial_no" TEXT NOT NULL,
    "project_type" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "agreement_number" TEXT,
    "department" TEXT,
    "division" TEXT,
    "sub_division" TEXT,
    "irrigation_capacity" TEXT,
    "project_location" TEXT,
    "village" TEXT,
    "district" TEXT,
    "state" TEXT,
    "contractor_name" TEXT,
    "contractor_phone" TEXT,
    "contractor_email" TEXT,
    "contractor_address" TEXT,
    "sub_contractors" JSONB,
    "start_date" DATE,
    "planned_end_date" DATE,
    "work_period" TEXT,
    "work_order" TEXT,
    "work_order_date" DATE,
    "work_order_document" TEXT,
    "work_order_doc_name" TEXT,
    "tender_id" TEXT,
    "tender_amount" DECIMAL(15,2),
    "percentage" DECIMAL(5,2),
    "maintenance_period" TEXT,
    "project_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_project_minor" (
    "id" TEXT NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "minor_name" TEXT NOT NULL,
    "contractor_name" TEXT,
    "po_number" TEXT,
    "schedule_file" TEXT,
    "schedule_file_id" TEXT,
    "schedule_file_name" TEXT,
    "schedule_rows" JSONB,
    "schedule_headers" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_project_minor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_project_design" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_project_design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_project_execution" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "entry_id" TEXT,
    "date" DATE,
    "stage_number" INTEGER,
    "stage_name" TEXT,
    "submission_date_time" TEXT,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_project_execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_project_actual" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "entry_id" TEXT,
    "date" DATE,
    "stage_number" INTEGER,
    "stage_name" TEXT,
    "submission_date_time" TEXT,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_project_actual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_stage_entry" (
    "id" TEXT NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "stage_number" INTEGER NOT NULL,
    "step_index" INTEGER NOT NULL,
    "status" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_stage_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_mobilization" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "consultants" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_mobilization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_finalize_consultant" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "consultants" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_finalize_consultant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_sent_po" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "consultants" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_sent_po_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_survey" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "survey_status" TEXT,
    "survey_start_date" DATE,
    "survey_end_date" DATE,
    "drawing_ready" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_survey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_drawing_upload" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "drawing_date" DATE,
    "drawing_file" TEXT,
    "drawing_file_name" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_drawing_upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_final_approval" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "sub_division" BOOLEAN NOT NULL DEFAULT false,
    "division" BOOLEAN NOT NULL DEFAULT false,
    "circle_office" BOOLEAN NOT NULL DEFAULT false,
    "ceo_office" BOOLEAN NOT NULL DEFAULT false,
    "approval_date" DATE,
    "remarks" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_final_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_drawing" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "minors" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_drawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_material_requirement" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "indent_no" TEXT,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_material_requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_schedule" (
    "id" BIGSERIAL NOT NULL,
    "minor_id" TEXT NOT NULL,
    "file_id" TEXT,
    "file_url" TEXT,
    "file_name" TEXT,
    "rows" JSONB,
    "headers" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_rm_bill" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "project_no" TEXT NOT NULL,
    "bill_no" TEXT,
    "rm_no" TEXT,
    "bill_type" TEXT NOT NULL,
    "bill_date" DATE,
    "total_amount" DECIMAL(15,2),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "remarks" TEXT,
    "entries" JSONB NOT NULL,
    "calculations" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_rm_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_product_imf" (
    "id" BIGSERIAL NOT NULL,
    "po_number" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_product_imf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_document" (
    "id" BIGSERIAL NOT NULL,
    "document_uid" TEXT NOT NULL,
    "project_no" TEXT,
    "project_name" TEXT,
    "agreement_no" TEXT,
    "title" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" TEXT,
    "file_type" TEXT,
    "recipient" TEXT,
    "ref_no" TEXT,
    "date" DATE,
    "remarks" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_email_log" (
    "id" BIGSERIAL NOT NULL,
    "log_uid" TEXT NOT NULL,
    "project_no" TEXT,
    "project_name" TEXT,
    "agreement_no" TEXT,
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "attached_docs" JSONB,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'Sent',
    "sender" TEXT,

    CONSTRAINT "pms_email_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_calculation_state" (
    "id" BIGSERIAL NOT NULL,
    "project_no" TEXT NOT NULL,
    "state_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB NOT NULL,
    "audit_logs" JSONB,
    "snapshots" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pms_calculation_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_indent" (
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
    "vendor_type" TEXT,
    "product_code" TEXT,
    "comparison_sheet_url" TEXT,
    "comparison_sheet_filename" TEXT,
    "technical_approved_at" TIMESTAMP(3),
    "technical_approved_by" TEXT,
    "technical_approval_remarks" TEXT,
    "management_approved_at" TIMESTAMP(3),
    "management_approved_by" TEXT,
    "management_approval_remarks" TEXT,
    "approved_vendor_name" TEXT,
    "approved_rate" DECIMAL(15,2),
    "po_required" BOOLEAN NOT NULL DEFAULT false,
    "selected_vendor_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pms_indent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_indent_item" (
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

-- CreateTable
CREATE TABLE "pms_indent_vendor" (
    "id" SERIAL NOT NULL,
    "indent_id" INTEGER NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "rate" DECIMAL(15,2) NOT NULL,
    "gst_percent" DECIMAL(5,2) NOT NULL,
    "payment_terms" TEXT,
    "delivery_days" INTEGER,
    "quotation_url" TEXT,
    "quotation_filename" TEXT,
    "rank" INTEGER,
    "enquiry_no" TEXT,
    "enquiry_date" DATE,
    "rate_unit" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "make" TEXT,

    CONSTRAINT "pms_indent_vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_po" (
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

-- CreateTable
CREATE TABLE "pms_po_item" (
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

-- CreateIndex
CREATE UNIQUE INDEX "pms_project_serial_no_key" ON "pms_project"("serial_no");

-- CreateIndex
CREATE INDEX "pms_project_minor_project_no_idx" ON "pms_project_minor"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_project_design_project_no_key" ON "pms_project_design"("project_no");

-- CreateIndex
CREATE INDEX "pms_project_design_project_no_idx" ON "pms_project_design"("project_no");

-- CreateIndex
CREATE INDEX "pms_project_execution_project_no_idx" ON "pms_project_execution"("project_no");

-- CreateIndex
CREATE INDEX "pms_project_execution_project_no_stage_number_idx" ON "pms_project_execution"("project_no", "stage_number");

-- CreateIndex
CREATE INDEX "pms_project_execution_entry_id_idx" ON "pms_project_execution"("entry_id");

-- CreateIndex
CREATE INDEX "pms_project_actual_project_no_idx" ON "pms_project_actual"("project_no");

-- CreateIndex
CREATE INDEX "pms_project_actual_project_no_stage_number_idx" ON "pms_project_actual"("project_no", "stage_number");

-- CreateIndex
CREATE INDEX "pms_project_actual_entry_id_idx" ON "pms_project_actual"("entry_id");

-- CreateIndex
CREATE INDEX "pms_stage_entry_project_no_stage_number_idx" ON "pms_stage_entry"("project_no", "stage_number");

-- CreateIndex
CREATE UNIQUE INDEX "pms_mobilization_project_no_key" ON "pms_mobilization"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_finalize_consultant_project_no_key" ON "pms_finalize_consultant"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_sent_po_project_no_key" ON "pms_sent_po"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_survey_project_no_key" ON "pms_survey"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_drawing_upload_project_no_key" ON "pms_drawing_upload"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_final_approval_project_no_key" ON "pms_final_approval"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_drawing_project_no_key" ON "pms_drawing"("project_no");

-- CreateIndex
CREATE INDEX "pms_material_requirement_project_no_idx" ON "pms_material_requirement"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_schedule_minor_id_key" ON "pms_schedule"("minor_id");

-- CreateIndex
CREATE INDEX "pms_rm_bill_project_no_bill_type_idx" ON "pms_rm_bill"("project_no", "bill_type");

-- CreateIndex
CREATE UNIQUE INDEX "pms_product_imf_po_number_key" ON "pms_product_imf"("po_number");

-- CreateIndex
CREATE UNIQUE INDEX "pms_document_document_uid_key" ON "pms_document"("document_uid");

-- CreateIndex
CREATE INDEX "pms_document_project_no_idx" ON "pms_document"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_email_log_log_uid_key" ON "pms_email_log"("log_uid");

-- CreateIndex
CREATE INDEX "pms_email_log_project_no_idx" ON "pms_email_log"("project_no");

-- CreateIndex
CREATE UNIQUE INDEX "pms_calculation_state_project_no_state_type_key" ON "pms_calculation_state"("project_no", "state_type");

-- CreateIndex
CREATE INDEX "pms_indent_stage_idx" ON "pms_indent"("stage");

-- CreateIndex
CREATE INDEX "pms_indent_vendor_indent_id_idx" ON "pms_indent_vendor"("indent_id");

-- CreateIndex
CREATE UNIQUE INDEX "pms_po_po_number_key" ON "pms_po"("po_number");

-- CreateIndex
CREATE INDEX "pms_po_indent_id_idx" ON "pms_po"("indent_id");

-- CreateIndex
CREATE INDEX "area_of_use_name_id_idx" ON "area_of_use"("name" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "firm_firm_name_id_idx" ON "firm"("firm_name" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "fullkitting_timestamp_id_idx" ON "fullkitting"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "group_head_name_id_idx" ON "group_head"("name" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "indent_indent_number_id_idx" ON "indent"("indent_number" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "inventory_item_name_id_idx" ON "inventory"("item_name" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "issue_issue_no_id_idx" ON "issue"("issue_no" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "issue_timestamp_id_idx" ON "issue"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payments_timestamp_id_idx" ON "payments"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "payments_actual_id_idx" ON "payments"("actual" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "po_master_timestamp_id_idx" ON "po_master"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stock_transfers_timestamp_id_idx" ON "stock_transfers"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "store_in_indent_no_id_idx" ON "store_in"("indent_no" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "store_in_timestamp_id_idx" ON "store_in"("timestamp" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "tally_entry_lift_number_id_idx" ON "tally_entry"("lift_number" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "uom_name_id_idx" ON "uom"("name" ASC, "id" ASC);

-- CreateIndex
CREATE INDEX "vendors_vendor_name_id_idx" ON "vendors"("vendor_name" ASC, "id" ASC);

-- AddForeignKey
ALTER TABLE "pms_project_minor" ADD CONSTRAINT "pms_project_minor_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_project_design" ADD CONSTRAINT "pms_project_design_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_project_execution" ADD CONSTRAINT "pms_project_execution_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_project_actual" ADD CONSTRAINT "pms_project_actual_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_stage_entry" ADD CONSTRAINT "pms_stage_entry_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_mobilization" ADD CONSTRAINT "pms_mobilization_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_finalize_consultant" ADD CONSTRAINT "pms_finalize_consultant_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_sent_po" ADD CONSTRAINT "pms_sent_po_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_survey" ADD CONSTRAINT "pms_survey_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_drawing_upload" ADD CONSTRAINT "pms_drawing_upload_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_final_approval" ADD CONSTRAINT "pms_final_approval_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_drawing" ADD CONSTRAINT "pms_drawing_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_material_requirement" ADD CONSTRAINT "pms_material_requirement_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_schedule" ADD CONSTRAINT "pms_schedule_minor_id_fkey" FOREIGN KEY ("minor_id") REFERENCES "pms_project_minor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_rm_bill" ADD CONSTRAINT "pms_rm_bill_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_calculation_state" ADD CONSTRAINT "pms_calculation_state_project_no_fkey" FOREIGN KEY ("project_no") REFERENCES "pms_project"("serial_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_indent" ADD CONSTRAINT "pms_indent_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_indent" ADD CONSTRAINT "pms_indent_selected_vendor_id_fkey" FOREIGN KEY ("selected_vendor_id") REFERENCES "pms_indent_vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_indent_item" ADD CONSTRAINT "pms_indent_item_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_indent_vendor" ADD CONSTRAINT "pms_indent_vendor_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_po" ADD CONSTRAINT "pms_po_indent_id_fkey" FOREIGN KEY ("indent_id") REFERENCES "pms_indent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_po" ADD CONSTRAINT "pms_po_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pms_project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_po_item" ADD CONSTRAINT "pms_po_item_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "pms_po"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "machine_document_events_doc_idx" RENAME TO "machine_document_events_documentId_at_idx";

-- RenameIndex
ALTER INDEX "machine_document_files_doc_sort_key" RENAME TO "machine_document_files_documentId_sortOrder_key";

