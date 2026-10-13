-- AlterTable
ALTER TABLE "indent" ALTER COLUMN "received_qty" DROP DEFAULT;

-- CreateTable
CREATE TABLE "area_of_use" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "area_of_use_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company" (
    "id" BIGSERIAL NOT NULL,
    "company_name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contact_person" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billing_address" TEXT,
    "destination_address" TEXT,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_details" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "contractor_name" TEXT NOT NULL,
    "contractor_gstin" TEXT,
    "contractor_address" TEXT,
    "contractor_email" TEXT,
    "responsible_person" TEXT,
    "location" TEXT,
    "phone" TEXT,

    CONSTRAINT "contractor_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_po_terms" (
    "id" BIGSERIAL NOT NULL,
    "term_text" TEXT NOT NULL,
    "sort_order" INTEGER,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "default_po_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm" (
    "id" BIGSERIAL NOT NULL,
    "company_id" BIGINT,
    "firm_name" TEXT NOT NULL,
    "billing_address" TEXT,
    "destination_address" TEXT,
    "contact_person" TEXT,
    "active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fullkitting" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMP NOT NULL,
    "indent_number" TEXT,
    "vendor_name" TEXT,
    "product_name" TEXT,
    "qty" TEXT,
    "bill_no" TEXT,
    "transporting_include" TEXT,
    "transporter_name" TEXT,
    "amount" TEXT,
    "vehical_no" TEXT,
    "driver_name" TEXT,
    "driver_mobile_no" TEXT,
    "planned" TIMESTAMP,
    "actual" TIMESTAMP,
    "time_delay" TEXT,
    "fms_name_match" TEXT,
    "status" TEXT,
    "vehicle_number" TEXT,
    "from" TEXT,
    "to" TEXT,
    "material_load_details" TEXT,
    "bilty_number" TEXT,
    "rate_type" TEXT,
    "amount1" TEXT,
    "bilty_image" TEXT,
    "firm_name" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "fullkitting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_head" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "group_head" TEXT,
    "item_name" TEXT,
    "uom" TEXT,
    "max_level" TEXT,
    "opening" TEXT,
    "individual_rate" TEXT,
    "indented" DECIMAL(65,30) DEFAULT 0,
    "approved" DECIMAL(65,30),
    "purchase_quantity" DECIMAL(65,30),
    "out_quantity" DECIMAL(65,30),
    "current" DECIMAL(65,30),
    "total_price" DECIMAL(65,30),
    "color_code" TEXT,
    "received_quantity" DECIMAL(65,30),
    "return_quantity" DECIMAL(65,30),
    "request_quantity" DECIMAL(65,30),
    "firm_name" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "department" TEXT,
    "group_head" TEXT,
    "product_name" TEXT,
    "quantity" TEXT,
    "uom" TEXT,
    "issue_to" TEXT,
    "planned1" TIMESTAMP,
    "actual1" TIMESTAMP,
    "time_delay1" TEXT,
    "status" TEXT,
    "given_qty" TEXT,
    "issue_no" TEXT,
    "constructor_name" TEXT,
    "site_location" TEXT,
    "firm_name" TEXT,
    "rejected_damage_qty" TEXT,
    "damage_remark" TEXT,
    "return_person_name" TEXT,
    "issue_person_name" TEXT,
    "issue_slip" TEXT,
    "return_slip" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" BIGSERIAL NOT NULL,
    "item_name" TEXT NOT NULL,
    "group_head_id" BIGINT,
    "uom_id" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "regular_pay_condition" TEXT,
    "third_party_pay_condition" TEXT,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master" (
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendor_name" TEXT,
    "vendor_gstin" TEXT,
    "vendor_address" TEXT,
    "vendor_email" TEXT,
    "payment_term" TEXT,
    "department" TEXT,
    "group_head" TEXT,
    "item_name" TEXT,
    "company_name" TEXT,
    "company_address" TEXT,
    "company_email" TEXT,
    "company_gstin" TEXT,
    "company_phone" TEXT,
    "billing_address" TEXT,
    "company_pan" TEXT,
    "destination_address" TEXT,
    "default_terms" TEXT,
    "person_name" TEXT,
    "firm_name" TEXT,
    "uom" TEXT,
    "where" TEXT,
    "fms_name" TEXT,
    "indenter_name" TEXT,
    "id" BIGSERIAL NOT NULL,
    "responsible_person" TEXT,
    "regular" TEXT,
    "location" TEXT,
    "phone" TEXT,
    "regular_conditions" TEXT,
    "third_party_conditions" TEXT,
    "area_of_use" TEXT,
    "company_contact_person" TEXT,

    CONSTRAINT "master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_history" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "ap_payment_number" TEXT,
    "status" TEXT,
    "unique_number" TEXT,
    "fms_name" TEXT,
    "pay_to" TEXT,
    "amount_to_be_paid" TEXT,
    "remarks" TEXT,
    "any_attachments" TEXT,
    "timestamp1" TIMESTAMP,
    "lift_number" TEXT,
    "indent_no" TEXT,
    "po_number" TEXT,
    "vendor_name" TEXT,
    "product_name" TEXT,
    "bill_status" TEXT,
    "bill_no" TEXT,
    "qty" TEXT,
    "lead_time_to_lift_material" TEXT,
    "type_of_bill" TEXT,
    "bill_amount" TEXT,
    "discount_amount" TEXT,
    "payment_type" TEXT,
    "advance_amount_if_any" TEXT,
    "photo_of_bill" TEXT,
    "transportation_include" TEXT,
    "transporter_name" TEXT,
    "amount" TEXT,
    "vehicle_no" TEXT,
    "driver_name" TEXT,
    "driver_mobile_no" TEXT,
    "bill_remark" TEXT,
    "planned" DATE,
    "payment_terms" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "payment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ,
    "unique_no" TEXT,
    "party_name" TEXT,
    "po_number" TEXT,
    "total_po_amount" TEXT,
    "internal_code" TEXT,
    "product" TEXT,
    "delivery_date" DATE,
    "payment_terms" TEXT,
    "number_of_days" TEXT,
    "pdf" TEXT,
    "pay_amount" TEXT,
    "file" TEXT,
    "remark" TEXT,
    "total_paid_amount" TEXT,
    "outstanding_amount" TEXT,
    "status" TEXT,
    "planned" DATE,
    "actual" DATE,
    "type_of_bill" TEXT,
    "status1" TEXT,
    "payment_form" TEXT,
    "firm_name" TEXT,
    "payment_done" BOOLEAN,
    "firm_id" BIGINT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pc_report" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stage" TEXT,
    "total_pending" TEXT,
    "total_complete" TEXT,
    "pending_pmpl" TEXT,
    "pending_purab" TEXT,
    "pending_pmmpl" TEXT,
    "pending_refrasynth" TEXT,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pc_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "po_master" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "party_name" TEXT,
    "po_number" TEXT,
    "quotation_number" TEXT,
    "quotation_date" TEXT,
    "enquiry_number" TEXT,
    "enquiry_date" TEXT,
    "internal_code" TEXT,
    "product" TEXT,
    "description" TEXT,
    "quantity" TEXT,
    "unit" TEXT,
    "rate" TEXT,
    "gst" TEXT,
    "discount" TEXT,
    "amount" TEXT,
    "total_po_amount" TEXT,
    "prepared_by" TEXT,
    "approved_by" TEXT,
    "pdf" TEXT,
    "delivery_date" TEXT,
    "payment_terms" TEXT,
    "number_of_days" TEXT,
    "term1" TEXT,
    "term2" TEXT,
    "term3" TEXT,
    "term4" TEXT,
    "term5" TEXT,
    "term6" TEXT,
    "term7" TEXT,
    "term8" TEXT,
    "term9" TEXT,
    "term10" TEXT,
    "email_send_status" TEXT,
    "delivery_days" TEXT,
    "delivery_type" TEXT,
    "firm_name" TEXT,
    "total_paid_amount" DECIMAL(65,30),
    "outstanding_amount" DECIMAL(65,30),
    "status" TEXT,
    "company_email" TEXT,
    "advance_percent" DECIMAL(65,30) DEFAULT 0,
    "advance_amount" DECIMAL(65,30) DEFAULT 0,
    "terms" TEXT,
    "destination_address" TEXT,
    "site_engineer_name" TEXT,
    "site_engineer_email" TEXT,
    "site_engineer_phoneNo" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "po_master_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_history" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "timestamp" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "quatationNo" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "adreess" TEXT,
    "gst" TEXT,
    "indentNo" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "description" TEXT,
    "qty" TEXT,
    "unit" TEXT,
    "pdfLink" TEXT,
    "firm" TEXT DEFAULT 'N/A',
    "token" TEXT,
    "vendor_rate" DECIMAL(65,30),
    "responded_at" TIMESTAMPTZ,
    "vendor_remarks" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "quotation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "received" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "indent_number" TEXT,
    "po_date" TEXT,
    "po_number" TEXT,
    "vendor" TEXT,
    "received_status" TEXT,
    "received_quantity" TEXT,
    "uom" TEXT,
    "photo_of_product" TEXT,
    "warranty_status" TEXT,
    "end_date" TEXT,
    "bill_status" TEXT,
    "bill_number" TEXT,
    "bill_amount" TEXT,
    "photo_of_bill" TEXT,
    "any_transportations" TEXT,
    "transporter_name" TEXT,
    "transporting_amount" TEXT,

    CONSTRAINT "received_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_engineer_details" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "site_engineer_details_pkey" PRIMARY KEY ("id","number")
);

-- CreateTable
CREATE TABLE "site_location_details" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT NOT NULL,

    CONSTRAINT "site_location_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "serial_number" TEXT,
    "group_head" TEXT,
    "product_name" TEXT,
    "uom" TEXT,
    "opening" DECIMAL(65,30),
    "min_level" DECIMAL(65,30),
    "latest_price" DECIMAL(65,30),
    "intransit" DECIMAL(65,30),
    "received" DECIMAL(65,30),
    "consumed" DECIMAL(65,30),
    "current_stock" DECIMAL(65,30),
    "value" DECIMAL(65,30),
    "required" DECIMAL(65,30),
    "condition" TEXT,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "transfer_no" TEXT NOT NULL,
    "from_project" TEXT NOT NULL,
    "to_project" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "uom" TEXT,
    "group_head" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL,
    "remark" TEXT DEFAULT 'Internal Stock Transfer',
    "status" TEXT DEFAULT 'Approved',
    "from_firm_id" BIGINT,
    "to_firm_id" BIGINT,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_in" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "lift_number" TEXT,
    "indent_no" TEXT,
    "po_number" TEXT,
    "vendor_name" TEXT,
    "product_name" TEXT,
    "bill_status" TEXT,
    "bill_no" TEXT,
    "qty" TEXT,
    "lead_time_to_lift_material" TEXT,
    "type_of_bill" TEXT,
    "bill_amount" TEXT,
    "discount_amount" TEXT,
    "payment_type" TEXT,
    "advance_amount_if_any" TEXT,
    "photo_of_bill" TEXT,
    "transportation_include" TEXT,
    "transporter_name" TEXT,
    "amount" TEXT,
    "vehicle_no" TEXT,
    "driver_name" TEXT,
    "driver_mobile_no" TEXT,
    "bill_remark" TEXT,
    "planned6" TIMESTAMP,
    "actual6" TIMESTAMP,
    "time_delay6" TEXT,
    "receiving_status" TEXT,
    "received_quantity" TEXT,
    "photo_of_product" TEXT,
    "damage_order" TEXT,
    "quantity_as_per_bill" TEXT,
    "remark" TEXT,
    "planned7" TIMESTAMP,
    "actual7" TIMESTAMP,
    "time_delay7" TEXT,
    "status" TEXT,
    "bill_copy_attached" TEXT,
    "reason" TEXT,
    "send_debit_note" TEXT,
    "planned9" TIMESTAMP,
    "actual9" TIMESTAMP,
    "time_delay9" TEXT,
    "debit_note_copy" TEXT,
    "debit_note_number" TEXT,
    "firm_name" TEXT,
    "lifting_status" TEXT,
    "planned11" TIMESTAMP,
    "actual11" TIMESTAMP,
    "time_delay" TEXT,
    "bill_status_new" TEXT,
    "bill_image_status" TEXT,
    "indent_date" TEXT,
    "indent_qty" TEXT,
    "purchase_date" TEXT,
    "material_date" TEXT,
    "party_name" TEXT,
    "location" TEXT,
    "area" TEXT,
    "not_bill_received_no" TEXT,
    "indented_for" TEXT,
    "approved_party_name" TEXT,
    "rate" TEXT,
    "total_rate" TEXT,
    "bill_received2" TEXT,
    "price_as_per_po_check" TEXT,
    "hod_status" TEXT,
    "hod_remark" TEXT,
    "hod_planned" TIMESTAMPTZ,
    "hod_actual" TIMESTAMPTZ,
    "challan_no" TEXT,
    "challan_image" TEXT,
    "receiver_name" TEXT,
    "firm_name_match" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "store_in_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_in_direct" (
    "id" TEXT NOT NULL,
    "lift_number" TEXT,
    "indent_no" TEXT,
    "receiver_name" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "bill_no" TEXT,
    "bill_amount" DECIMAL(65,30) DEFAULT 0,
    "product_name" TEXT NOT NULL,
    "qty" DECIMAL(65,30) DEFAULT 0,
    "receiving_status" TEXT DEFAULT 'Received',
    "received_quantity" DECIMAL(65,30) DEFAULT 0,
    "photo_of_bill" TEXT,
    "photo_of_product" TEXT,
    "transportation_include" TEXT DEFAULT 'No',
    "transporter_name" TEXT,
    "amount" DECIMAL(65,30) DEFAULT 0,
    "vehicle_no" TEXT,
    "firm_name_match" TEXT,
    "timestamp" TIMESTAMPTZ,
    "actual6" TIMESTAMPTZ,
    "hod_status" TEXT,
    "created_at" TIMESTAMPTZ,
    "firm_id" BIGINT,
    "firm_name" TEXT,

    CONSTRAINT "store_in_direct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tally_entry" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMP NOT NULL,
    "lift_number" TEXT,
    "indent_number" TEXT,
    "po_number" TEXT,
    "material_in_date" TEXT,
    "product_name" TEXT,
    "bill_status" TEXT,
    "qty" TEXT,
    "party_name" TEXT,
    "bill_amt" TEXT,
    "bill_image" TEXT,
    "bill_no" TEXT,
    "location" TEXT,
    "type_of_bills" TEXT,
    "product_image" TEXT,
    "area" TEXT,
    "indented_for" TEXT,
    "approved_party_name" TEXT,
    "rate" TEXT,
    "indent_qty" TEXT,
    "total_rate" TEXT,
    "bill_recieved_later" TEXT,
    "planned1" TIMESTAMP,
    "actual1" TIMESTAMP,
    "delay1" TEXT,
    "status1" TEXT,
    "firm_name" TEXT,
    "remarks1" TEXT,
    "planned2" TIMESTAMP,
    "actual2" TIMESTAMP,
    "delay2" TEXT,
    "status2" TEXT,
    "remarks2" TEXT,
    "planned3" TIMESTAMP,
    "actual3" TIMESTAMP,
    "delay3" TEXT,
    "status3" TEXT,
    "remarks3" TEXT,
    "planned4" TIMESTAMP,
    "actual4" TIMESTAMP,
    "delay4" TEXT,
    "status4" TEXT,
    "remarks4" TEXT,
    "planned5" TIMESTAMP,
    "actual5" TIMESTAMP,
    "delay5" TEXT,
    "status5" TEXT,
    "remarks5" TEXT,
    "firm_name_match" TEXT,
    "firm_id" BIGINT,

    CONSTRAINT "tally_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms_and_condition" (
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "id" BIGSERIAL NOT NULL,

    CONSTRAINT "terms_and_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uom" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_name" TEXT,
    "password" TEXT,
    "name" TEXT,
    "administrate" BOOLEAN,
    "store_issue" BOOLEAN,
    "issue_data" BOOLEAN,
    "inventory" BOOLEAN,
    "create_indent" BOOLEAN,
    "create_po" BOOLEAN,
    "indent_approval_view" BOOLEAN,
    "indent_approval_action" BOOLEAN,
    "update_vendor_view" BOOLEAN,
    "update_vendor_action" BOOLEAN,
    "three_party_approval_view" BOOLEAN,
    "three_party_approval_action" BOOLEAN,
    "receive_item_view" BOOLEAN,
    "receive_item_action" BOOLEAN,
    "store_out_approval_view" BOOLEAN,
    "store_out_approval_action" BOOLEAN,
    "pending_indents_view" BOOLEAN,
    "orders_view" BOOLEAN,
    "again_auditing" BOOLEAN,
    "take_entry_by_telly" BOOLEAN,
    "reaudit_data" BOOLEAN,
    "rectify_the_mistake" BOOLEAN,
    "audit_data" BOOLEAN,
    "send_debit_note" BOOLEAN,
    "return_material_to_party" BOOLEAN,
    "exchange_materials" BOOLEAN,
    "instead_of_quality_check_in_received_item" BOOLEAN,
    "db_for_pc" BOOLEAN,
    "bill_not_received" BOOLEAN,
    "store_in" BOOLEAN,
    "po_history" BOOLEAN,
    "full_kiting" BOOLEAN,
    "make_payment" BOOLEAN,
    "pending_po" BOOLEAN,
    "hod_store_approval" BOOLEAN,
    "firm_access" BIGINT,
    "store_issue_return" BOOLEAN,
    "modify_access" "AccessType" NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" BIGSERIAL NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "gstin" TEXT,
    "address" TEXT,
    "email" TEXT,
    "payment_term" TEXT,
    "person_name" TEXT,
    "phone" TEXT,
    "location" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "firm" ADD CONSTRAINT "firm_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fullkitting" ADD CONSTRAINT "fullkitting_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indent" ADD CONSTRAINT "indent_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue" ADD CONSTRAINT "issue_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_group_head_id_fkey" FOREIGN KEY ("group_head_id") REFERENCES "group_head"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "uom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_history" ADD CONSTRAINT "payment_history_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "po_master" ADD CONSTRAINT "po_master_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_history" ADD CONSTRAINT "quotation_history_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_firm_id_fkey" FOREIGN KEY ("from_firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_firm_id_fkey" FOREIGN KEY ("to_firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_in" ADD CONSTRAINT "store_in_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_in_direct" ADD CONSTRAINT "store_in_direct_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tally_entry" ADD CONSTRAINT "tally_entry_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
