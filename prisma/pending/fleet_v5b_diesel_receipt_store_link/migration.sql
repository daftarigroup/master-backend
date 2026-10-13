-- fleet_v5b_diesel_receipt_store_link: records DieselReceipt columns that already exist in the local master_db
-- (added by the Store -> fleet diesel sync work) but were never written to a migration file.
-- Idempotent: safe to run on the local DB (no-op) and on a fresh or RDS database. Rollback notes: down.sql

DO $$ BEGIN
  CREATE TYPE "DieselReceiptSource" AS ENUM ('MANUAL', 'STORE_ISSUE', 'STORE_IN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "diesel_receipts" ADD COLUMN IF NOT EXISTS "source" "DieselReceiptSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "diesel_receipts" ADD COLUMN IF NOT EXISTS "externalRef" TEXT;
ALTER TABLE "diesel_receipts" ADD COLUMN IF NOT EXISTS "issuerName" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "diesel_receipts_externalRef_key" ON "diesel_receipts" ("externalRef");
