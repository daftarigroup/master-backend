-- CreateEnum
CREATE TYPE "ProjectAssignmentStatus" AS ENUM ('active', 'on_leave', 'shifted', 'removed', 'completed');

-- CreateEnum
CREATE TYPE "ProjectAssignmentEventType" AS ENUM ('assigned', 'resumed', 'shifted', 'removed', 'completed', 'put_on_leave');

-- CreateTable
CREATE TABLE "project_assignments" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "firm_id" BIGINT NOT NULL,
    "firm_name" TEXT NOT NULL,
    "role_on_project" TEXT NOT NULL,
    "status" "ProjectAssignmentStatus" NOT NULL DEFAULT 'active',
    "assigned_date" TIMESTAMPTZ NOT NULL,
    "end_date" TIMESTAMPTZ,
    "linked_assignment_id" BIGINT,
    "reason" TEXT,
    "approved_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_assignment_events" (
    "id" BIGSERIAL NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "event_type" "ProjectAssignmentEventType" NOT NULL,
    "from_firm_id" BIGINT,
    "to_firm_id" BIGINT,
    "from_firm_name" TEXT,
    "to_firm_name" TEXT,
    "notes" TEXT,
    "performed_by" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_assignment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_assignments_employee_id_idx" ON "project_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "project_assignments_firm_id_idx" ON "project_assignments"("firm_id");

-- CreateIndex
CREATE INDEX "project_assignments_status_idx" ON "project_assignments"("status");

-- Partial unique index: only one active/on_leave assignment per employee at a time
CREATE UNIQUE INDEX "project_assignments_single_active_per_employee"
  ON "project_assignments" ("employee_id")
  WHERE status IN ('active', 'on_leave');

-- CreateIndex
CREATE INDEX "project_assignment_events_assignment_id_idx" ON "project_assignment_events"("assignment_id");

-- CreateIndex
CREATE INDEX "project_assignment_events_employee_id_idx" ON "project_assignment_events"("employee_id");

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_linked_assignment_id_fkey" FOREIGN KEY ("linked_assignment_id") REFERENCES "project_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignment_events" ADD CONSTRAINT "project_assignment_events_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "project_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
