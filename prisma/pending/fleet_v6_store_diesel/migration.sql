-- fleet_v6_store_diesel: the machine diesel log is fed by approved Store issues (Phase 2 of the Store x Asset x M&R integration).
-- Additive and idempotent. Rollback: down.sql
--   meterReading   the meter reading given on the Store issue (a spot reading, not a start / stop pair)
--   storeIssueId   the Store issue this log came from (at most one live log per issue)
--   flags          review flags, e.g. READING_BELOW_LAST, READING_JUMP (saved, not blocked)

ALTER TABLE "diesel_logs" ADD COLUMN IF NOT EXISTS "meterReading" numeric(14, 2);
ALTER TABLE "diesel_logs" ADD COLUMN IF NOT EXISTS "storeIssueId" bigint;
ALTER TABLE "diesel_logs" ADD COLUMN IF NOT EXISTS "flags" text[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'diesel_logs_storeIssueId_fkey') THEN
    ALTER TABLE "diesel_logs" ADD CONSTRAINT "diesel_logs_storeIssueId_fkey" FOREIGN KEY ("storeIssueId") REFERENCES "issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "diesel_logs_one_per_store_issue" ON "diesel_logs" ("storeIssueId") WHERE "storeIssueId" IS NOT NULL AND "voidedAt" IS NULL;
