-- Rollback for fleet_v1/migration.sql. Safe because the migration only ADDED objects:
-- dropping them returns the schema to its previous shape and loses only data written
-- since the migration (diesel, usage logs, ownership, new work-order columns).
-- Take a pg_dump first if anything has been entered through the new screens.

BEGIN;

ALTER TABLE "maintenance_work_orders"
  DROP CONSTRAINT IF EXISTS "maintenance_work_orders_activityTypeId_fkey",
  DROP CONSTRAINT IF EXISTS "maintenance_work_orders_requestedById_fkey",
  DROP CONSTRAINT IF EXISTS "maintenance_work_orders_vendorId_fkey";
DROP INDEX IF EXISTS "maintenance_work_orders_outsourceStatus_idx";
ALTER TABLE "maintenance_work_orders"
  DROP COLUMN IF EXISTS "title",
  DROP COLUMN IF EXISTS "description",
  DROP COLUMN IF EXISTS "activityTypeId",
  DROP COLUMN IF EXISTS "documentUrl",
  DROP COLUMN IF EXISTS "requestedById",
  DROP COLUMN IF EXISTS "outsourceStatus",
  DROP COLUMN IF EXISTS "vendorId",
  DROP COLUMN IF EXISTS "sentAt",
  DROP COLUMN IF EXISTS "receivedAt",
  DROP COLUMN IF EXISTS "paidAt",
  DROP COLUMN IF EXISTS "billNo",
  DROP COLUMN IF EXISTS "rollupAppliedAt";

-- note: maintenance_work_orders."firmId" values backfilled from machines are left in place.
-- They are correct data for a column that already existed, so they are not reverted.

DROP TABLE IF EXISTS "diesel_logs";
DROP TABLE IF EXISTS "machine_usage_logs";
DROP TABLE IF EXISTS "diesel_receipts";

DROP INDEX IF EXISTS "assets_firmId_ownershipType_idx";
ALTER TABLE "assets" DROP COLUMN IF EXISTS "ownershipType";

ALTER TABLE "machines"
  DROP CONSTRAINT IF EXISTS "machines_siteLocationId_fkey",
  DROP CONSTRAINT IF EXISTS "machines_rentalVendorId_fkey";
DROP INDEX IF EXISTS "machines_firmId_ownershipType_idx";
ALTER TABLE "machines"
  DROP COLUMN IF EXISTS "ownershipType",
  DROP COLUMN IF EXISTS "equipmentType",
  DROP COLUMN IF EXISTS "readingUnit",
  DROP COLUMN IF EXISTS "openingReading",
  DROP COLUMN IF EXISTS "expectedConsumption",
  DROP COLUMN IF EXISTS "maxUsagePerEntry",
  DROP COLUMN IF EXISTS "registrationNo",
  DROP COLUMN IF EXISTS "siteLocationId",
  DROP COLUMN IF EXISTS "rentalStartAt",
  DROP COLUMN IF EXISTS "rentalEndAt",
  DROP COLUMN IF EXISTS "rentalVendorId",
  DROP COLUMN IF EXISTS "rentalVendorName",
  DROP COLUMN IF EXISTS "hireType";

DROP TYPE IF EXISTS "OutsourceStatus";
DROP TYPE IF EXISTS "DieselLogSource";
DROP TYPE IF EXISTS "DieselReceiptKind";
DROP TYPE IF EXISTS "EquipmentType";
DROP TYPE IF EXISTS "HireType";
DROP TYPE IF EXISTS "ReadingUnit";
DROP TYPE IF EXISTS "OwnershipType";

COMMIT;
