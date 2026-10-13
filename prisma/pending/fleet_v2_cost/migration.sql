-- fleet_v2_cost: equipment cost tracking (rate cards, manual cost entries, WBS activities, per-firm fleet settings,
-- diesel valuation stamped at write time, WBS tags on usage and diesel).
--
-- STATUS: authored. Design: md/ASSET_EQUIPMENT_COST_PHASE1_PLAN.md section A. Builds on fleet_v1.
-- Additive only: no existing column is altered or dropped. Rollback is down.sql.
-- Quoted camelCase columns match the existing convention (Prisma models without @map).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "MachineRateType"    AS ENUM ('INTERNAL_HOURLY', 'RENTAL');
CREATE TYPE "RateBasis"          AS ENUM ('HOUR', 'DAY', 'MONTH', 'KM');
CREATE TYPE "CostEntryCategory"  AS ENUM ('OPERATOR', 'TRANSPORT', 'INSURANCE', 'CONSUMABLES', 'RENTAL_INVOICE', 'OTHER');
CREATE TYPE "DieselRateSource"   AS ENUM ('RECEIPT_AVG', 'STORE', 'DEFAULT', 'MANUAL');
CREATE TYPE "WbsStatus"          AS ENUM ('ACTIVE', 'CLOSED');

-- ---------------------------------------------------------------------------
-- 2. New tables
-- ---------------------------------------------------------------------------
-- One row per firm. Created lazily by the service, and backfilled below for firms that already own machines.
CREATE TABLE "fleet_settings" (
  "firmId"              BIGINT PRIMARY KEY,
  "standardHoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
  "idleAfterDays"       INTEGER NOT NULL DEFAULT 2,
  "defaultDieselRate"   DECIMAL(10,4),
  "workingDays"         INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6]::INTEGER[], -- ISO weekday, 1 = Monday .. 7 = Sunday
  "updatedAt"           TIMESTAMPTZ(3) NOT NULL, -- no default: Prisma's @updatedAt supplies it
  "updatedById"         BIGINT,
  CONSTRAINT "fleet_settings_firmId_fkey"      FOREIGN KEY ("firmId")      REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fleet_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fleet_settings_hours_chk" CHECK ("standardHoursPerDay" > 0 AND "standardHoursPerDay" <= 24),
  CONSTRAINT "fleet_settings_idle_chk"  CHECK ("idleAfterDays" >= 0),
  CONSTRAINT "fleet_settings_rate_chk"  CHECK ("defaultDieselRate" IS NULL OR "defaultDieselRate" > 0),
  CONSTRAINT "fleet_settings_days_chk"  CHECK (cardinality("workingDays") BETWEEN 1 AND 7 AND "workingDays" <@ ARRAY[1,2,3,4,5,6,7]::INTEGER[])
);

-- Work-breakdown activities that usage, diesel and cost entries are booked against.
CREATE TABLE "wbs_activities" (
  "id"             TEXT PRIMARY KEY,
  "firmId"         BIGINT NOT NULL,
  "code"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "parentId"       TEXT,
  "status"         "WbsStatus" NOT NULL DEFAULT 'ACTIVE',
  "siteLocationId" BIGINT,
  "createdAt"      TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "wbs_activities_firmId_fkey"         FOREIGN KEY ("firmId")         REFERENCES "firm"("id")                  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "wbs_activities_parentId_fkey"       FOREIGN KEY ("parentId")       REFERENCES "wbs_activities"("id")        ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "wbs_activities_siteLocationId_fkey" FOREIGN KEY ("siteLocationId") REFERENCES "site_location_details"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "wbs_activities_parent_chk" CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE UNIQUE INDEX "wbs_activities_firmId_code_key" ON "wbs_activities"("firmId", "code");
CREATE INDEX "wbs_activities_firmId_status_idx" ON "wbs_activities"("firmId", "status");

-- Effective-dated rate card. Append-only: a change adds a row with a later effectiveFrom, and the previous row is closed by
-- setting its effectiveTo (the only permitted update). History is never rewritten.
CREATE TABLE "machine_rates" (
  "id"                  TEXT PRIMARY KEY,
  "firmId"              BIGINT NOT NULL,
  "machineId"           TEXT NOT NULL,
  "rateType"            "MachineRateType" NOT NULL,
  "basis"               "RateBasis" NOT NULL,
  "amount"              DECIMAL(12,4) NOT NULL,
  "minBillableQty"      DECIMAL(12,2),
  "extraRate"           DECIMAL(12,4),
  "deductBreakdownDays" BOOLEAN NOT NULL DEFAULT FALSE,
  "effectiveFrom"       DATE NOT NULL,
  "effectiveTo"         DATE,
  "note"                TEXT,
  "createdById"         BIGINT NOT NULL,
  "createdAt"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machine_rates_firmId_fkey"      FOREIGN KEY ("firmId")      REFERENCES "firm"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_rates_machineId_fkey"   FOREIGN KEY ("machineId")   REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_rates_amount_chk" CHECK ("amount" >= 0),
  CONSTRAINT "machine_rates_min_chk"    CHECK ("minBillableQty" IS NULL OR "minBillableQty" >= 0),
  CONSTRAINT "machine_rates_extra_chk"  CHECK ("extraRate" IS NULL OR "extraRate" >= 0),
  CONSTRAINT "machine_rates_range_chk"  CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);
CREATE UNIQUE INDEX "machine_rates_machineId_rateType_effectiveFrom_key" ON "machine_rates"("machineId", "rateType", "effectiveFrom");
CREATE INDEX "machine_rates_firmId_machineId_idx" ON "machine_rates"("firmId", "machineId");

-- Manual costs (operator, transport, insurance, consumables, rental invoices, other).
CREATE TABLE "machine_cost_entries" (
  "id"            TEXT PRIMARY KEY,
  "firmId"        BIGINT NOT NULL,
  "machineId"     TEXT NOT NULL,
  "costDate"      DATE NOT NULL, -- IST calendar day
  "category"      "CostEntryCategory" NOT NULL,
  "amount"        DECIMAL(14,2) NOT NULL,
  "wbsActivityId" TEXT,
  "description"   TEXT,
  "attachmentUrl" TEXT,
  "createdById"   BIGINT NOT NULL,
  "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt"      TIMESTAMPTZ(3),
  "voidedById"    BIGINT,
  "voidReason"    TEXT,
  CONSTRAINT "machine_cost_entries_firmId_fkey"        FOREIGN KEY ("firmId")        REFERENCES "firm"("id")           ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_cost_entries_machineId_fkey"     FOREIGN KEY ("machineId")     REFERENCES "machines"("id")       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_cost_entries_wbsActivityId_fkey" FOREIGN KEY ("wbsActivityId") REFERENCES "wbs_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_cost_entries_createdById_fkey"   FOREIGN KEY ("createdById")   REFERENCES "user"("id")           ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_cost_entries_voidedById_fkey"    FOREIGN KEY ("voidedById")    REFERENCES "user"("id")           ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_cost_entries_amount_chk" CHECK ("amount" > 0)
);
CREATE INDEX "machine_cost_entries_firmId_machineId_costDate_idx" ON "machine_cost_entries"("firmId", "machineId", "costDate");
CREATE INDEX "machine_cost_entries_active_idx" ON "machine_cost_entries"("firmId", "costDate", "machineId") WHERE "voidedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Columns on existing tables (all nullable or defaulted)
-- ---------------------------------------------------------------------------
ALTER TABLE "machines"
  ADD COLUMN "shiftHoursPerDay" DECIMAL(4,2),
  ADD CONSTRAINT "machines_shiftHoursPerDay_chk" CHECK ("shiftHoursPerDay" IS NULL OR ("shiftHoursPerDay" > 0 AND "shiftHoursPerDay" <= 24));

ALTER TABLE "machine_usage_logs"
  ADD COLUMN "wbsActivityId" TEXT,
  ADD CONSTRAINT "machine_usage_logs_wbsActivityId_fkey" FOREIGN KEY ("wbsActivityId")
    REFERENCES "wbs_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Diesel valuation is stamped on each issue when it is written. NULL on the three columns = not priced ("estimated / set rate").
ALTER TABLE "diesel_logs"
  ADD COLUMN "wbsActivityId" TEXT,
  ADD COLUMN "ratePerLitre"  DECIMAL(10,4),
  ADD COLUMN "amount"        DECIMAL(14,2),
  ADD COLUMN "rateSource"    "DieselRateSource",
  ADD CONSTRAINT "diesel_logs_wbsActivityId_fkey" FOREIGN KEY ("wbsActivityId")
    REFERENCES "wbs_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "diesel_logs_valuation_chk" CHECK (
    ("ratePerLitre" IS NULL) = ("amount" IS NULL) AND ("ratePerLitre" IS NULL) = ("rateSource" IS NULL)
  ),
  ADD CONSTRAINT "diesel_logs_rate_chk" CHECK ("ratePerLitre" IS NULL OR ("ratePerLitre" >= 0 AND "amount" >= 0));

ALTER TABLE "diesel_receipts"
  ADD COLUMN "ratePerLitre" DECIMAL(10,4),
  ADD COLUMN "totalAmount"  DECIMAL(14,2),
  ADD CONSTRAINT "diesel_receipts_valuation_chk" CHECK (("ratePerLitre" IS NULL) = ("totalAmount" IS NULL)),
  ADD CONSTRAINT "diesel_receipts_rate_chk" CHECK ("ratePerLitre" IS NULL OR ("ratePerLitre" >= 0 AND "totalAmount" >= 0));

-- ---------------------------------------------------------------------------
-- 4. Indexes for the cost queries (fleet lists and cost summaries read these by firm + month)
-- ---------------------------------------------------------------------------
CREATE INDEX "machine_usage_logs_cost_idx" ON "machine_usage_logs"("firmId", "logDate", "machineId")
  WHERE "voidedAt" IS NULL AND "stopReading" IS NOT NULL;
CREATE INDEX "diesel_logs_cost_idx" ON "diesel_logs"("firmId", "issueDate", "machineId") WHERE "voidedAt" IS NULL;
CREATE INDEX "maintenance_work_orders_machineId_completedAt_idx" ON "maintenance_work_orders"("machineId", "completedAt");
CREATE INDEX "maintenance_work_orders_firmId_completedAt_idx" ON "maintenance_work_orders"("firmId", "completedAt");

-- ---------------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------------
-- A settings row (defaults) for every firm that already has machines. Historical diesel is left unpriced on purpose:
-- no receipt price exists and the firm default rate is unset, so nothing is invented. The cost screens show those logs as
-- "estimated / set rate" until a rate is entered.
INSERT INTO "fleet_settings" ("firmId", "updatedAt")
SELECT DISTINCT "firmId", CURRENT_TIMESTAMP FROM "machines" WHERE "firmId" IS NOT NULL
ON CONFLICT ("firmId") DO NOTHING;

COMMIT;
