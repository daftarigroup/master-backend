-- fleet_v2_cost rollback. Drops everything migration.sql added (the new tables lose their data).
-- Take a pg_dump first if anything has been entered through the cost screens.
BEGIN;

DROP INDEX IF EXISTS "maintenance_work_orders_firmId_completedAt_idx";
DROP INDEX IF EXISTS "maintenance_work_orders_machineId_completedAt_idx";
DROP INDEX IF EXISTS "diesel_logs_cost_idx";
DROP INDEX IF EXISTS "machine_usage_logs_cost_idx";

ALTER TABLE "diesel_receipts"
  DROP CONSTRAINT "diesel_receipts_rate_chk",
  DROP CONSTRAINT "diesel_receipts_valuation_chk",
  DROP COLUMN "totalAmount",
  DROP COLUMN "ratePerLitre";

ALTER TABLE "diesel_logs"
  DROP CONSTRAINT "diesel_logs_rate_chk",
  DROP CONSTRAINT "diesel_logs_valuation_chk",
  DROP CONSTRAINT "diesel_logs_wbsActivityId_fkey",
  DROP COLUMN "rateSource",
  DROP COLUMN "amount",
  DROP COLUMN "ratePerLitre",
  DROP COLUMN "wbsActivityId";

ALTER TABLE "machine_usage_logs"
  DROP CONSTRAINT "machine_usage_logs_wbsActivityId_fkey",
  DROP COLUMN "wbsActivityId";

ALTER TABLE "machines"
  DROP CONSTRAINT "machines_shiftHoursPerDay_chk",
  DROP COLUMN "shiftHoursPerDay";

DROP TABLE "machine_cost_entries";
DROP TABLE "machine_rates";
DROP TABLE "wbs_activities";
DROP TABLE "fleet_settings";

DROP TYPE "WbsStatus";
DROP TYPE "DieselRateSource";
DROP TYPE "CostEntryCategory";
DROP TYPE "RateBasis";
DROP TYPE "MachineRateType";

COMMIT;
