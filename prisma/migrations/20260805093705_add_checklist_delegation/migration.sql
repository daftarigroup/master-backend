-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'done', 'extend', 'extended', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "user" ADD COLUMN "role" "Role" DEFAULT 'USER';
ALTER TABLE "user" ADD COLUMN "day_off" TEXT;

-- CreateTable
CREATE TABLE "checklist_task" (
    "task_id" BIGSERIAL NOT NULL,
    "firm_id" BIGINT,
    "firm_name" TEXT,
    "doer_id" BIGINT,
    "doer_name" TEXT,
    "given_by_id" BIGINT,
    "given_by_name" TEXT,
    "task_description" TEXT,
    "frequency" TEXT,
    "enable_reminder" BOOLEAN DEFAULT false,
    "reminder_days_before" INTEGER DEFAULT 1,
    "early_reminder_sent" BOOLEAN DEFAULT false,
    "require_attachment" BOOLEAN DEFAULT false,
    "duration" TEXT,
    "planned_date" TIMESTAMP(3),
    "task_start_date" TIMESTAMP(3),
    "submission_date" TIMESTAMP(3),
    "status" "TaskStatus" DEFAULT 'pending',
    "remark" TEXT,
    "image" TEXT,
    "audio_url" TEXT,
    "instruction_attachment_url" TEXT,
    "instruction_attachment_type" TEXT,
    "delay" TEXT,
    "admin_done" BOOLEAN DEFAULT false,
    "admin_approved_by" BIGINT,
    "admin_approval_date" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_task_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "delegation_task" (
    "task_id" BIGSERIAL NOT NULL,
    "firm_id" BIGINT,
    "firm_name" TEXT,
    "doer_id" BIGINT,
    "doer_name" TEXT,
    "given_by_id" BIGINT,
    "given_by_name" TEXT,
    "task_description" TEXT,
    "require_attachment" BOOLEAN DEFAULT false,
    "duration" TEXT,
    "task_start_date" TIMESTAMP(3) NOT NULL,
    "planned_date" TIMESTAMP(3),
    "submission_date" TIMESTAMP(3),
    "status" "TaskStatus" DEFAULT 'pending',
    "remark" TEXT,
    "image" TEXT,
    "audio_url" TEXT,
    "instruction_attachment_url" TEXT,
    "instruction_attachment_type" TEXT,
    "delay" TEXT,
    "admin_done" BOOLEAN DEFAULT false,
    "admin_approved_by" BIGINT,
    "admin_approval_date" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,

    CONSTRAINT "delegation_task_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "delegation_done" (
    "id" BIGSERIAL NOT NULL,
    "task_id" BIGINT,
    "status" "TaskStatus",
    "next_extend_date" TIMESTAMP(3),
    "reason" TEXT,
    "image_url" TEXT,
    "audio_url" TEXT,
    "duration" TEXT,
    "admin_done" BOOLEAN DEFAULT false,
    "admin_approved_by" BIGINT,
    "admin_approval_date" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegation_done_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holiday" (
    "id" BIGSERIAL NOT NULL,
    "holiday_date" DATE NOT NULL,
    "holiday_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_day_calendar" (
    "id" BIGSERIAL NOT NULL,
    "working_date" DATE NOT NULL,
    "day" TEXT,
    "week_num" INTEGER,
    "month" INTEGER,

    CONSTRAINT "working_day_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "holiday_holiday_date_key" ON "holiday"("holiday_date");

-- AddForeignKey
ALTER TABLE "checklist_task" ADD CONSTRAINT "checklist_task_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_task" ADD CONSTRAINT "delegation_task_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegation_done" ADD CONSTRAINT "delegation_done_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "delegation_task"("task_id") ON DELETE SET NULL ON UPDATE CASCADE;
