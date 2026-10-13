-- Rollback for fleet_v6_store_diesel. Drops the Store link, reading and flags of diesel logs (their data is lost).
DROP INDEX IF EXISTS "diesel_logs_one_per_store_issue";
ALTER TABLE "diesel_logs" DROP CONSTRAINT IF EXISTS "diesel_logs_storeIssueId_fkey";
ALTER TABLE "diesel_logs" DROP COLUMN IF EXISTS "flags";
ALTER TABLE "diesel_logs" DROP COLUMN IF EXISTS "storeIssueId";
ALTER TABLE "diesel_logs" DROP COLUMN IF EXISTS "meterReading";
