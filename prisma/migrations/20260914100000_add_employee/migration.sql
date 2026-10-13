-- CreateTable
CREATE TABLE "employee" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "emp_code" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "designation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "department_id" BIGINT,
    "home_firm_id" BIGINT,
    "user_id" BIGINT,
    "joining_date" TIMESTAMPTZ,
    "last_working_day" TIMESTAMPTZ,
    "termination_date" TIMESTAMPTZ,
    "separation_type" TEXT,
    "leaving_reason" TEXT,
    "manager_name" TEXT,
    "work_location" TEXT,
    "employment_type" TEXT,
    "joining_place" TEXT,
    "attendance_mode" TEXT,
    "probation_months" INTEGER,
    "offered_ctc" TEXT,
    "monthly_salary" DECIMAL(12,2),
    "bank_account" TEXT,
    "ifsc_code" TEXT,
    "bank_branch_name" TEXT,
    "payment_mode" TEXT,
    "pf_eligible" BOOLEAN DEFAULT false,
    "esic_eligible" BOOLEAN DEFAULT false,
    "past_pf_no" TEXT,
    "esic_no" TEXT,
    "blood_group" TEXT,
    "father_name" TEXT,
    "highest_qualification" TEXT,
    "current_address" TEXT,
    "aadhar_address" TEXT,
    "aadhar_no" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "email_to_be_issued" BOOLEAN DEFAULT false,
    "mobile_to_be_issued" BOOLEAN DEFAULT false,
    "laptop_to_be_issued" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_employee_id_key" ON "employee"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_emp_code_key" ON "employee"("emp_code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_user_id_key" ON "employee"("user_id");

-- CreateIndex
CREATE INDEX "employee_status_idx" ON "employee"("status");

-- CreateIndex
CREATE INDEX "employee_home_firm_id_idx" ON "employee"("home_firm_id");

-- CreateIndex
CREATE INDEX "employee_department_id_idx" ON "employee"("department_id");

-- CreateIndex
CREATE INDEX "employee_phone_idx" ON "employee"("phone");

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_home_firm_id_fkey" FOREIGN KEY ("home_firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("employee_id") ON DELETE RESTRICT ON UPDATE CASCADE;
