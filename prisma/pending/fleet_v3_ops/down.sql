-- fleet_v3_ops rollback. Drops everything the migration added, in reverse dependency order. The new tables lose their data;
-- existing columns (done, cost, documentUrls, runningHours, usage readings) were never changed, so nothing else is lost.
BEGIN;

DROP TABLE IF EXISTS "machine_transfer_events";
DROP TABLE IF EXISTS "machine_transfers";
DROP TABLE IF EXISTS "machine_operator_assignments";
DROP TABLE IF EXISTS "machine_assignments";

DROP TABLE IF EXISTS "machine_documents";

ALTER TABLE "work_order_repair_parts"
  DROP CONSTRAINT IF EXISTS "work_order_repair_parts_unitCost_chk",
  DROP CONSTRAINT IF EXISTS "work_order_repair_parts_machinePartId_fkey",
  DROP COLUMN IF EXISTS "machinePartId",
  DROP COLUMN IF EXISTS "unitCost";

DROP INDEX IF EXISTS "maintenance_work_orders_one_open_per_schedule";
DROP INDEX IF EXISTS "maintenance_work_orders_scheduleId_idx";
DROP INDEX IF EXISTS "maintenance_work_orders_responsibleId_idx";
ALTER TABLE "maintenance_work_orders"
  DROP CONSTRAINT IF EXISTS "maintenance_work_orders_costs_chk",
  DROP CONSTRAINT IF EXISTS "maintenance_work_orders_scheduleId_fkey",
  DROP CONSTRAINT IF EXISTS "maintenance_work_orders_responsibleId_fkey",
  DROP COLUMN IF EXISTS "actualLabourCost",
  DROP COLUMN IF EXISTS "actualPartsCost",
  DROP COLUMN IF EXISTS "estLabourCost",
  DROP COLUMN IF EXISTS "estPartsCost",
  DROP COLUMN IF EXISTS "readingAtService",
  DROP COLUMN IF EXISTS "scheduleId",
  DROP COLUMN IF EXISTS "serviceMode",
  DROP COLUMN IF EXISTS "responsibleId";

ALTER TABLE "work_order_checklist_items"
  DROP CONSTRAINT IF EXISTS "work_order_checklist_items_issue_chk",
  DROP CONSTRAINT IF EXISTS "work_order_checklist_items_doneById_fkey",
  DROP COLUMN IF EXISTS "photoUrl",
  DROP COLUMN IF EXISTS "doneAt",
  DROP COLUMN IF EXISTS "doneById",
  DROP COLUMN IF EXISTS "note",
  DROP COLUMN IF EXISTS "state";

DROP TABLE IF EXISTS "machine_service_schedules";
DROP TABLE IF EXISTS "checklist_template_items";
DROP TABLE IF EXISTS "checklist_templates";

ALTER TABLE "machines"
  DROP CONSTRAINT IF EXISTS "machines_defaultResponsibleId_fkey",
  DROP CONSTRAINT IF EXISTS "machines_defaultMechanicId_fkey",
  DROP COLUMN IF EXISTS "capacityLabel",
  DROP COLUMN IF EXISTS "defaultResponsibleId",
  DROP COLUMN IF EXISTS "defaultMechanicId";

ALTER TABLE "fleet_settings"
  DROP CONSTRAINT IF EXISTS "fleet_settings_lead_chk",
  DROP CONSTRAINT IF EXISTS "fleet_settings_shift_chk",
  DROP COLUMN IF EXISTS "serviceLeadDays",
  DROP COLUMN IF EXISTS "serviceLeadPercent",
  DROP COLUMN IF EXISTS "countPendingLogsInTotals",
  DROP COLUMN IF EXISTS "blockWorkWhenServiceOverdue",
  DROP COLUMN IF EXISTS "dayShiftEndMin",
  DROP COLUMN IF EXISTS "dayShiftStartMin";

ALTER TABLE "wbs_activities" DROP CONSTRAINT IF EXISTS "wbs_activities_defaultWorkTypeId_fkey", DROP COLUMN IF EXISTS "defaultWorkTypeId";

ALTER TABLE "machine_usage_logs" DROP CONSTRAINT IF EXISTS "machine_usage_logs_workTypeId_fkey";
DROP TABLE IF EXISTS "work_types";
DROP TABLE IF EXISTS "work_log_status_logs";

DROP INDEX IF EXISTS "machine_usage_logs_firmId_status_logDate_idx";
DROP INDEX IF EXISTS "machine_usage_logs_firm_logNumber_key";
DROP INDEX IF EXISTS "machine_usage_logs_firm_clientRequestId_key";
ALTER TABLE "machine_usage_logs"
  DROP CONSTRAINT IF EXISTS "machine_usage_reject_chk",
  DROP CONSTRAINT IF EXISTS "machine_usage_trips_chk",
  DROP CONSTRAINT IF EXISTS "machine_usage_output_chk",
  DROP CONSTRAINT IF EXISTS "machine_usage_logs_approvedById_fkey",
  DROP COLUMN IF EXISTS "clientRequestId",
  DROP COLUMN IF EXISTS "rejectReason",
  DROP COLUMN IF EXISTS "approvedAt",
  DROP COLUMN IF EXISTS "approvedById",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "trips",
  DROP COLUMN IF EXISTS "outputUnit",
  DROP COLUMN IF EXISTS "outputQty",
  DROP COLUMN IF EXISTS "locationText",
  DROP COLUMN IF EXISTS "workTypeId",
  DROP COLUMN IF EXISTS "shift",
  DROP COLUMN IF EXISTS "logNumber";

-- the WL counters created by the backfill
DELETE FROM "document_sequences" WHERE "prefix" IN ('WL', 'TRF');

DROP TYPE IF EXISTS "TransferStatus";
DROP TYPE IF EXISTS "MachineDocType";
DROP TYPE IF EXISTS "ServiceMode";
DROP TYPE IF EXISTS "ChecklistState";
DROP TYPE IF EXISTS "WorkLogStatus";
DROP TYPE IF EXISTS "WorkShift";

COMMIT;
