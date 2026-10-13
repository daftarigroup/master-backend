-- fleet_v1: owned/rented machines, reading-based usage logbook, site diesel ledger,
-- and work-order columns for the merged Maintenance + Repair system.
--
-- STATUS: authored, NOT applied anywhere. Design: md/FLEET_DIESEL_AND_MAINTENANCE_MERGE_PLAN.md §A.
-- Additive only: no existing column is altered or dropped. Rollback is down.sql.
-- Quoted camelCase columns match the existing convention (Prisma models without @map).
-- Run on a COPY of the database first (see README.md).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "OwnershipType"     AS ENUM ('OWNED', 'RENTED');
CREATE TYPE "ReadingUnit"       AS ENUM ('KM', 'HOURS', 'NONE');
CREATE TYPE "HireType"          AS ENUM ('DRY', 'WET');
CREATE TYPE "EquipmentType"     AS ENUM ('EXCAVATOR', 'BACKHOE_LOADER', 'TIPPER', 'TRUCK', 'TRANSIT_MIXER', 'ROLLER',
                                         'TRACTOR', 'WATER_PUMP', 'DG_SET', 'CAR', 'OTHER');
CREATE TYPE "DieselReceiptKind" AS ENUM ('RECEIPT', 'OPENING', 'ADJUSTMENT');
CREATE TYPE "DieselLogSource"   AS ENUM ('MANUAL', 'STORE_ISSUE');
CREATE TYPE "OutsourceStatus"   AS ENUM ('TO_SEND', 'SENT', 'RECEIVED', 'PAID');

-- ---------------------------------------------------------------------------
-- 2. machines: ownership, equipment type, reading basis, rental fields
-- ---------------------------------------------------------------------------
ALTER TABLE "machines"
  ADD COLUMN "ownershipType"       "OwnershipType" NOT NULL DEFAULT 'OWNED',
  ADD COLUMN "equipmentType"       "EquipmentType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "readingUnit"         "ReadingUnit"   NOT NULL DEFAULT 'HOURS',
  ADD COLUMN "openingReading"      DECIMAL(12,2)   NOT NULL DEFAULT 0,
  ADD COLUMN "expectedConsumption" DECIMAL(8,3),
  ADD COLUMN "maxUsagePerEntry"    DECIMAL(10,2),
  ADD COLUMN "registrationNo"      TEXT,
  ADD COLUMN "siteLocationId"      BIGINT,
  ADD COLUMN "rentalStartAt"       TIMESTAMPTZ(3),
  ADD COLUMN "rentalEndAt"         TIMESTAMPTZ(3),
  ADD COLUMN "rentalVendorId"      TEXT,
  ADD COLUMN "rentalVendorName"    TEXT,
  ADD COLUMN "hireType"            "HireType";

ALTER TABLE "machines"
  ADD CONSTRAINT "machines_siteLocationId_fkey" FOREIGN KEY ("siteLocationId")
    REFERENCES "site_location_details"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "machines_rentalVendorId_fkey" FOREIGN KEY ("rentalVendorId")
    REFERENCES "repair_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "machines_firmId_ownershipType_idx" ON "machines"("firmId", "ownershipType");

-- assets: stored (not derived) so assets without a machine have a value and the list filters server-side
ALTER TABLE "assets" ADD COLUMN "ownershipType" "OwnershipType" NOT NULL DEFAULT 'OWNED';
CREATE INDEX "assets_firmId_ownershipType_idx" ON "assets"("firmId", "ownershipType");

-- ---------------------------------------------------------------------------
-- 3. New tables
-- ---------------------------------------------------------------------------
CREATE TABLE "diesel_receipts" (
  "id"             TEXT PRIMARY KEY,
  "firmId"         BIGINT NOT NULL,
  "siteLocationId" BIGINT,
  "kind"           "DieselReceiptKind" NOT NULL DEFAULT 'RECEIPT',
  "receivedAt"     TIMESTAMPTZ(3) NOT NULL,
  "receiptDate"    DATE NOT NULL,
  "litres"         DECIMAL(10,2) NOT NULL,
  "supplierName"   TEXT,
  "reference"      TEXT,
  "note"           TEXT,
  "createdById"    BIGINT NOT NULL,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt"       TIMESTAMPTZ(3),
  "voidedById"     BIGINT,
  "voidReason"     TEXT,
  CONSTRAINT "diesel_receipts_firmId_fkey"         FOREIGN KEY ("firmId")         REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "diesel_receipts_siteLocationId_fkey" FOREIGN KEY ("siteLocationId") REFERENCES "site_location_details"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "diesel_receipts_createdById_fkey"    FOREIGN KEY ("createdById")    REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "diesel_receipts_voidedById_fkey"     FOREIGN KEY ("voidedById")     REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "diesel_receipts_litres_chk" CHECK ("kind" = 'ADJUSTMENT' OR "litres" > 0)
);
CREATE INDEX "diesel_receipts_firmId_receiptDate_idx" ON "diesel_receipts"("firmId", "receiptDate");
-- one opening balance per firm while not voided
CREATE UNIQUE INDEX "diesel_receipts_one_opening_idx" ON "diesel_receipts"("firmId")
  WHERE "kind" = 'OPENING' AND "voidedAt" IS NULL;

CREATE TABLE "machine_usage_logs" (
  "id"               TEXT PRIMARY KEY,
  "firmId"           BIGINT NOT NULL,
  "machineId"        TEXT NOT NULL,
  "logDate"          DATE NOT NULL,
  "startedAt"        TIMESTAMPTZ(3) NOT NULL,
  "stoppedAt"        TIMESTAMPTZ(3),
  "startReading"     DECIMAL(12,2) NOT NULL,
  "stopReading"      DECIMAL(12,2),
  "usage"            DECIMAL(12,2),
  "meterReset"       BOOLEAN NOT NULL DEFAULT FALSE,
  "meterResetReason" TEXT,
  "continuityGap"    DECIMAL(12,2),
  "continuityReason" TEXT,
  "isFlagged"        BOOLEAN NOT NULL DEFAULT FALSE,
  "flagReasons"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "operatorId"       BIGINT,
  "remarks"          TEXT,
  "createdById"      BIGINT NOT NULL,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(3) NOT NULL, -- no default: Prisma's @updatedAt supplies it (keeps schema drift at zero)
  "voidedAt"         TIMESTAMPTZ(3),
  "voidedById"       BIGINT,
  "voidReason"       TEXT,
  CONSTRAINT "machine_usage_logs_firmId_fkey"      FOREIGN KEY ("firmId")      REFERENCES "firm"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_usage_logs_machineId_fkey"   FOREIGN KEY ("machineId")   REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_usage_logs_operatorId_fkey"  FOREIGN KEY ("operatorId")  REFERENCES "user"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_usage_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_usage_logs_voidedById_fkey"  FOREIGN KEY ("voidedById")  REFERENCES "user"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  -- data-quality rules 1 and 2: never a negative or partial usage; stop can't be below start
  CONSTRAINT "machine_usage_logs_readings_chk" CHECK ("startReading" >= 0 AND ("stopReading" IS NULL OR "stopReading" >= "startReading")),
  CONSTRAINT "machine_usage_logs_usage_chk"    CHECK ("usage" IS NULL OR "usage" >= 0),
  -- usage exists exactly when a stop reading exists
  CONSTRAINT "machine_usage_logs_open_chk"     CHECK (("stopReading" IS NULL) = ("usage" IS NULL))
);
CREATE INDEX "machine_usage_logs_machineId_startedAt_idx" ON "machine_usage_logs"("machineId", "startedAt");
CREATE INDEX "machine_usage_logs_firmId_logDate_idx"      ON "machine_usage_logs"("firmId", "logDate");
-- at most one OPEN entry per machine at a time (keeps the reading chain intact)
CREATE UNIQUE INDEX "machine_usage_one_open_idx" ON "machine_usage_logs"("machineId")
  WHERE "stopReading" IS NULL AND "voidedAt" IS NULL;

CREATE TABLE "diesel_logs" (
  "id"             TEXT PRIMARY KEY,
  "firmId"         BIGINT NOT NULL,
  "siteLocationId" BIGINT,
  "machineId"      TEXT,
  "consumerLabel"  TEXT,
  "usageLogId"     TEXT,
  "issuedAt"       TIMESTAMPTZ(3) NOT NULL,
  "issueDate"      DATE NOT NULL,
  "litres"         DECIMAL(10,2) NOT NULL,
  "source"         "DieselLogSource" NOT NULL DEFAULT 'MANUAL',
  "externalRef"    TEXT,
  "note"           TEXT,
  "createdById"    BIGINT NOT NULL,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt"       TIMESTAMPTZ(3),
  "voidedById"     BIGINT,
  "voidReason"     TEXT,
  CONSTRAINT "diesel_logs_firmId_fkey"         FOREIGN KEY ("firmId")         REFERENCES "firm"("id")               ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "diesel_logs_siteLocationId_fkey" FOREIGN KEY ("siteLocationId") REFERENCES "site_location_details"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "diesel_logs_machineId_fkey"      FOREIGN KEY ("machineId")      REFERENCES "machines"("id")           ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "diesel_logs_usageLogId_fkey"     FOREIGN KEY ("usageLogId")     REFERENCES "machine_usage_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "diesel_logs_createdById_fkey"    FOREIGN KEY ("createdById")    REFERENCES "user"("id")               ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "diesel_logs_voidedById_fkey"     FOREIGN KEY ("voidedById")     REFERENCES "user"("id")               ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "diesel_logs_litres_chk"    CHECK ("litres" > 0),
  -- a consumer is either a machine or a free-text label ("other diesel")
  CONSTRAINT "diesel_logs_consumer_chk"  CHECK ("machineId" IS NOT NULL OR length(trim(coalesce("consumerLabel", ''))) > 0)
);
CREATE INDEX "diesel_logs_firmId_issueDate_idx"    ON "diesel_logs"("firmId", "issueDate");
CREATE INDEX "diesel_logs_machineId_issueDate_idx" ON "diesel_logs"("machineId", "issueDate");
-- idempotency key for the future Store hook (recordIssue called twice with the same ref = one row).
-- A plain unique index is enough: Postgres allows many NULLs in a unique index.
CREATE UNIQUE INDEX "diesel_logs_externalRef_key" ON "diesel_logs"("externalRef");

-- ---------------------------------------------------------------------------
-- 4. maintenance_work_orders: own content (no hidden plan needed) + outsource track
-- ---------------------------------------------------------------------------
ALTER TABLE "maintenance_work_orders"
  ADD COLUMN "title"             TEXT,
  ADD COLUMN "description"       TEXT,
  ADD COLUMN "activityTypeId"    TEXT,
  ADD COLUMN "documentUrl"       TEXT,
  ADD COLUMN "requestedById"     BIGINT,
  ADD COLUMN "outsourceStatus"   "OutsourceStatus",
  ADD COLUMN "vendorId"          TEXT,
  ADD COLUMN "sentAt"            TIMESTAMPTZ(3),
  ADD COLUMN "receivedAt"        TIMESTAMPTZ(3),
  ADD COLUMN "paidAt"            TIMESTAMPTZ(3),
  ADD COLUMN "billNo"            TEXT,
  -- repair rollups on Asset/Machine are applied once per work order; set when applied
  ADD COLUMN "rollupAppliedAt"   TIMESTAMPTZ(3);

ALTER TABLE "maintenance_work_orders"
  ADD CONSTRAINT "maintenance_work_orders_activityTypeId_fkey" FOREIGN KEY ("activityTypeId")
    REFERENCES "activity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_work_orders_requestedById_fkey" FOREIGN KEY ("requestedById")
    REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_work_orders_vendorId_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "repair_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "maintenance_work_orders_outsourceStatus_idx" ON "maintenance_work_orders"("outsourceStatus");

-- ---------------------------------------------------------------------------
-- 5. Backfill (all inside this transaction)
-- ---------------------------------------------------------------------------

-- 5a. Ownership: the current "Hired" rule from the UI (no firm AND has a supplier) becomes data.
UPDATE "machines"
   SET "ownershipType"    = 'RENTED',
       "rentalVendorName" = btrim("supplier")
 WHERE "firmId" IS NULL AND "supplier" IS NOT NULL AND btrim("supplier") <> '';

-- 5b. Reading basis: existing runningHours becomes the opening reading (hours). Type/unit are
--     corrected per machine by users afterwards (the UI shows an "unreviewed" badge while
--     equipmentType is still OTHER).
UPDATE "machines" SET "openingReading" = "runningHours";

-- 5c. Assets follow their machine.
UPDATE "assets" a SET "ownershipType" = m."ownershipType"
  FROM "machines" m WHERE m."assetId" = a."id";

-- 5d. Work orders take over their plan's content and firm.
UPDATE "maintenance_work_orders" wo
   SET "title"          = p."title",
       "description"    = p."description",
       "activityTypeId" = p."activityTypeId",
       "documentUrl"    = p."documentUrl",
       "requestedById"  = p."createdById"
  FROM "maintenance_plans" p
 WHERE wo."planId" = p."id";

UPDATE "maintenance_work_orders" wo
   SET "firmId" = m."firmId"
  FROM "machines" m
 WHERE wo."machineId" = m."id" AND wo."firmId" IS NULL AND m."firmId" IS NOT NULL;

-- work orders with no plan (breakdowns) still need a readable title
UPDATE "maintenance_work_orders" wo
   SET "title" = initcap(lower(wo."type"::text)) || ' - ' || m."name"
  FROM "machines" m
 WHERE wo."machineId" = m."id" AND wo."title" IS NULL;

-- 5e. Outsource track from the existing indent -> outhouse -> dispatch/receiving/payment rows.
UPDATE "maintenance_work_orders" wo
   SET "vendorId" = ri."vendorId",
       "outsourceStatus" = CASE
         WHEN pay."status" = 'FULLY_PAID' THEN 'PAID'::"OutsourceStatus"
         WHEN rcv."id" IS NOT NULL        THEN 'RECEIVED'::"OutsourceStatus"
         WHEN dsp."id" IS NOT NULL        THEN 'SENT'::"OutsourceStatus"
         ELSE 'TO_SEND'::"OutsourceStatus"
       END,
       "sentAt"     = dsp."sentAt",
       "receivedAt" = rcv."receivedAt",
       "paidAt"     = CASE WHEN pay."status" = 'FULLY_PAID' THEN pay."paidAt" END,
       "billNo"     = rcv."billNo"
  FROM "repair_indents" ri
  JOIN "outhouse_repairs" orr ON orr."indentId" = ri."id"
  LEFT JOIN "repair_dispatches" dsp ON dsp."outhouseRepairId" = orr."id"
  LEFT JOIN "repair_receivings" rcv ON rcv."outhouseRepairId" = orr."id"
  LEFT JOIN "repair_payments"   pay ON pay."outhouseRepairId" = orr."id"
 WHERE ri."work_order_id" = wo."id" AND ri."routingType" = 'OUTHOUSE'; -- note: mapped column name

-- 5f. History is never rolled up again by the new once-only guard.
UPDATE "maintenance_work_orders"
   SET "rollupAppliedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP)
 WHERE "status" IN ('COMPLETED', 'COMPLETED_LATE');

COMMIT;
