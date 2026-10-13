-- Rollback for fleet_v5b_diesel_receipt_store_link. Only run on a database where nothing uses these columns:
-- the Store diesel sync (dieselReceipt.service.ts) writes them, so stop that first.
DROP INDEX IF EXISTS "diesel_receipts_externalRef_key";
ALTER TABLE "diesel_receipts" DROP COLUMN IF EXISTS "issuerName";
ALTER TABLE "diesel_receipts" DROP COLUMN IF EXISTS "externalRef";
ALTER TABLE "diesel_receipts" DROP COLUMN IF EXISTS "source";
DROP TYPE IF EXISTS "DieselReceiptSource";
