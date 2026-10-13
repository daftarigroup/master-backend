-- fleet_v3_ops: work logs, service schedules and checklists, machine documents, project assignments and transfers,
-- work-order task assignment (assigned to + responsible person).
--
-- STATUS: authored. Design: md/WORK_LOGS_MAINTENANCE_ASSIGNMENTS_PHASE1_PLAN.md section A. Builds on fleet_v1 + fleet_v2_cost.
-- Additive only: no existing column is altered or dropped, nothing is dropped. Rollback is down.sql.
-- Quoted camelCase columns match the existing convention (Prisma models without @map).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "WorkShift"      AS ENUM ('DAY', 'NIGHT', 'GENERAL');
CREATE TYPE "WorkLogStatus"  AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ChecklistState" AS ENUM ('PENDING', 'DONE', 'ISSUE');
CREATE TYPE "ServiceMode"    AS ENUM ('IN_HOUSE', 'VENDOR');
CREATE TYPE "MachineDocType" AS ENUM ('RC_BOOK', 'INSURANCE', 'PUC', 'FITNESS', 'OPERATOR_LICENSE', 'SERVICE_REPORT', 'BILL', 'OTHER');
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- ===========================================================================
-- A.1 WORK LOGS (a work log IS a machine_usage_logs row)
-- ===========================================================================
ALTER TABLE "machine_usage_logs"
  ADD COLUMN "logNumber"       TEXT,
  ADD COLUMN "shift"           "WorkShift" NOT NULL DEFAULT 'DAY',
  ADD COLUMN "workTypeId"      TEXT,
  ADD COLUMN "locationText"    TEXT,
  ADD COLUMN "outputQty"       DECIMAL(14,3),
  ADD COLUMN "outputUnit"      TEXT,
  ADD COLUMN "trips"           INTEGER,
  ADD COLUMN "status"          "WorkLogStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "approvedById"    BIGINT,
  ADD COLUMN "approvedAt"      TIMESTAMPTZ(3),
  ADD COLUMN "rejectReason"    TEXT,
  ADD COLUMN "clientRequestId" TEXT;

ALTER TABLE "machine_usage_logs"
  ADD CONSTRAINT "machine_usage_logs_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "machine_usage_output_chk"  CHECK ("outputQty" IS NULL OR "outputQty" >= 0),
  ADD CONSTRAINT "machine_usage_trips_chk"   CHECK ("trips" IS NULL OR "trips" >= 0),
  ADD CONSTRAINT "machine_usage_reject_chk"  CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("rejectReason", ''))) > 0);

-- retry-safe create (the client generates the id once per form) and the human-readable number, unique per firm
CREATE UNIQUE INDEX "machine_usage_logs_firm_clientRequestId_key" ON "machine_usage_logs"("firmId", "clientRequestId") WHERE "clientRequestId" IS NOT NULL;
CREATE UNIQUE INDEX "machine_usage_logs_firm_logNumber_key"       ON "machine_usage_logs"("firmId", "logNumber")       WHERE "logNumber" IS NOT NULL;
CREATE INDEX "machine_usage_logs_firmId_status_logDate_idx" ON "machine_usage_logs"("firmId", "status", "logDate");

CREATE TABLE "work_log_status_logs" (
  "id"         TEXT PRIMARY KEY,
  "usageLogId" TEXT NOT NULL,
  "fromStatus" "WorkLogStatus",
  "toStatus"   "WorkLogStatus" NOT NULL,
  "actorId"    BIGINT,
  "note"       TEXT,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_log_status_logs_usageLogId_fkey" FOREIGN KEY ("usageLogId") REFERENCES "machine_usage_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "work_log_status_logs_actorId_fkey"    FOREIGN KEY ("actorId")    REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "work_log_status_logs_usageLogId_createdAt_idx" ON "work_log_status_logs"("usageLogId", "createdAt");

CREATE TABLE "work_types" (
  "id"        TEXT PRIMARY KEY,
  "firmId"    BIGINT NOT NULL,
  "name"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "work_types_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "work_types_firmId_name_key" ON "work_types"("firmId", "name");

ALTER TABLE "machine_usage_logs"
  ADD CONSTRAINT "machine_usage_logs_workTypeId_fkey" FOREIGN KEY ("workTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wbs_activities" ADD COLUMN "defaultWorkTypeId" TEXT;
ALTER TABLE "wbs_activities" ADD CONSTRAINT "wbs_activities_defaultWorkTypeId_fkey" FOREIGN KEY ("defaultWorkTypeId") REFERENCES "work_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- shift boundaries are stored as minutes after midnight (IST); the work-log service reads them
ALTER TABLE "fleet_settings"
  ADD COLUMN "dayShiftStartMin"            INTEGER NOT NULL DEFAULT 360,   -- 06:00
  ADD COLUMN "dayShiftEndMin"              INTEGER NOT NULL DEFAULT 1080,  -- 18:00
  ADD COLUMN "blockWorkWhenServiceOverdue" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "countPendingLogsInTotals"    BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "serviceLeadPercent"          INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "serviceLeadDays"             INTEGER NOT NULL DEFAULT 7,
  ADD CONSTRAINT "fleet_settings_shift_chk" CHECK ("dayShiftStartMin" BETWEEN 0 AND 1439 AND "dayShiftEndMin" BETWEEN 1 AND 1440 AND "dayShiftStartMin" < "dayShiftEndMin"),
  ADD CONSTRAINT "fleet_settings_lead_chk"  CHECK ("serviceLeadPercent" BETWEEN 0 AND 100 AND "serviceLeadDays" >= 0);

-- ---- backfill: history is APPROVED, shift by the default 06:00-18:00 IST rule, numbers in time order per firm per year ----
UPDATE "machine_usage_logs" SET
  "status"     = 'APPROVED',
  "approvedAt" = "createdAt",
  "shift"      = CASE WHEN EXTRACT(HOUR FROM "startedAt" AT TIME ZONE 'Asia/Kolkata') BETWEEN 6 AND 17 THEN 'DAY'::"WorkShift" ELSE 'NIGHT'::"WorkShift" END;

WITH numbered AS (
  SELECT "id", "firmId", EXTRACT(YEAR FROM "logDate")::INT AS yr,
         ROW_NUMBER() OVER (PARTITION BY "firmId", EXTRACT(YEAR FROM "logDate") ORDER BY "startedAt", "id") AS n
  FROM "machine_usage_logs"
)
UPDATE "machine_usage_logs" u
SET "logNumber" = 'WL-' || numbered.yr || '-' || lpad(numbered.n::TEXT, 5, '0')
FROM numbered WHERE u."id" = numbered."id";

-- the sequence continues after the highest backfilled number, per firm and year
INSERT INTO "document_sequences" ("id", "firmId", "prefix", "year", "lastValue")
SELECT gen_random_uuid()::TEXT, "firmId", 'WL', EXTRACT(YEAR FROM "logDate")::INT, COUNT(*)
FROM "machine_usage_logs"
GROUP BY "firmId", EXTRACT(YEAR FROM "logDate")
ON CONFLICT ("firmId", "prefix", "year") DO UPDATE SET "lastValue" = GREATEST("document_sequences"."lastValue", EXCLUDED."lastValue");

-- default work types for every firm that owns machines (the service adds them lazily for any other firm)
INSERT INTO "work_types" ("id", "firmId", "name", "sortOrder")
SELECT gen_random_uuid()::TEXT, f."firmId", w.name, w.ord
FROM (SELECT DISTINCT "firmId" FROM "machines" WHERE "firmId" IS NOT NULL) f
CROSS JOIN (VALUES ('Excavation',1),('Backfilling',2),('Loading',3),('Hauling',4),('Levelling',5),('Lifting',6),('Pumping',7),('Other',8)) AS w(name, ord);

-- ===========================================================================
-- A.2 SERVICE SCHEDULES, CHECKLISTS, DOCUMENTS, COST SPLIT, TASK ASSIGNMENT
-- ===========================================================================
ALTER TABLE "machines"
  ADD COLUMN "defaultMechanicId"    BIGINT,
  ADD COLUMN "defaultResponsibleId" BIGINT,
  ADD COLUMN "capacityLabel"        TEXT,
  ADD CONSTRAINT "machines_defaultMechanicId_fkey"    FOREIGN KEY ("defaultMechanicId")    REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "machines_defaultResponsibleId_fkey" FOREIGN KEY ("defaultResponsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "checklist_templates" (
  "id"        TEXT PRIMARY KEY,
  "firmId"    BIGINT NOT NULL,
  "name"      TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checklist_templates_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "checklist_templates_firmId_name_key" ON "checklist_templates"("firmId", "name");

CREATE TABLE "checklist_template_items" (
  "id"         TEXT PRIMARY KEY,
  "templateId" TEXT NOT NULL,
  "text"       TEXT NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "checklist_template_items_templateId_idx" ON "checklist_template_items"("templateId");

-- the 8-item service checklist from the Maintenance Records design, editable by an admin
INSERT INTO "checklist_templates" ("id", "firmId", "name")
SELECT gen_random_uuid()::TEXT, f."firmId", 'Standard service'
FROM (SELECT DISTINCT "firmId" FROM "machines" WHERE "firmId" IS NOT NULL) f;

INSERT INTO "checklist_template_items" ("id", "templateId", "text", "sortOrder")
SELECT gen_random_uuid()::TEXT, t."id", i.text, i.ord
FROM "checklist_templates" t
CROSS JOIN (VALUES ('Engine Oil & Filter Change',1),('Hydraulic Oil Level Check',2),('Air Filter Cleaning',3),('Coolant Level Check',4),
                   ('Undercarriage Inspection',5),('Grease All Nipples',6),('Battery Condition Check',7),('Function Test',8)) AS i(text, ord)
WHERE t."name" = 'Standard service';

CREATE TABLE "machine_service_schedules" (
  "id"                  TEXT PRIMARY KEY,
  "firmId"              BIGINT NOT NULL,
  "machineId"           TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "intervalValue"       DECIMAL(12,2),   -- hours or km, per the machine's readingUnit
  "intervalDays"        INTEGER,
  "leadValue"           DECIMAL(12,2),   -- null = the firm default (serviceLeadPercent of the interval)
  "leadDays"            INTEGER,         -- null = the firm default
  "lastServiceAt"       DATE,
  "lastServiceReading"  DECIMAL(12,2),
  "checklistTemplateId" TEXT,
  "isActive"            BOOLEAN NOT NULL DEFAULT true,
  "createdById"         BIGINT,
  "createdAt"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machine_service_schedules_firmId_fkey"    FOREIGN KEY ("firmId")    REFERENCES "firm"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_service_schedules_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "machine_service_schedules_checklistTemplateId_fkey" FOREIGN KEY ("checklistTemplateId") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_service_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_service_schedules_interval_chk" CHECK (("intervalValue" IS NOT NULL AND "intervalValue" > 0) OR ("intervalDays" IS NOT NULL AND "intervalDays" > 0)),
  CONSTRAINT "machine_service_schedules_lead_chk" CHECK (("leadValue" IS NULL OR "leadValue" >= 0) AND ("leadDays" IS NULL OR "leadDays" >= 0))
);
CREATE INDEX "machine_service_schedules_machineId_isActive_idx" ON "machine_service_schedules"("machineId", "isActive");
CREATE INDEX "machine_service_schedules_firmId_isActive_idx"    ON "machine_service_schedules"("firmId", "isActive");

-- work-order checklist: state (Done / Pending / Issue) with who and when. The old boolean "done" stays and is kept in sync by the service.
ALTER TABLE "work_order_checklist_items"
  ADD COLUMN "state"    "ChecklistState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "note"     TEXT,
  ADD COLUMN "doneById" BIGINT,
  ADD COLUMN "doneAt"   TIMESTAMPTZ(3),
  ADD COLUMN "photoUrl" TEXT,
  ADD CONSTRAINT "work_order_checklist_items_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "work_order_checklist_items_issue_chk" CHECK ("state" <> 'ISSUE' OR length(btrim(coalesce("note", ''))) > 0);
UPDATE "work_order_checklist_items" SET "state" = 'DONE' WHERE "done" = true;

-- work orders: responsible person (accountable, approves), service mode and schedule link, reading at service, estimate / actual split
ALTER TABLE "maintenance_work_orders"
  ADD COLUMN "responsibleId"     BIGINT,
  ADD COLUMN "serviceMode"       "ServiceMode" NOT NULL DEFAULT 'IN_HOUSE',
  ADD COLUMN "scheduleId"        TEXT,
  ADD COLUMN "readingAtService"  DECIMAL(12,2),
  ADD COLUMN "estPartsCost"      DECIMAL(14,2),
  ADD COLUMN "estLabourCost"     DECIMAL(14,2),
  ADD COLUMN "actualPartsCost"   DECIMAL(14,2),
  ADD COLUMN "actualLabourCost"  DECIMAL(14,2),
  ADD CONSTRAINT "maintenance_work_orders_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_work_orders_scheduleId_fkey"    FOREIGN KEY ("scheduleId")    REFERENCES "machine_service_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "maintenance_work_orders_costs_chk" CHECK (
    ("estPartsCost" IS NULL OR "estPartsCost" >= 0) AND ("estLabourCost" IS NULL OR "estLabourCost" >= 0) AND
    ("actualPartsCost" IS NULL OR "actualPartsCost" >= 0) AND ("actualLabourCost" IS NULL OR "actualLabourCost" >= 0));
UPDATE "maintenance_work_orders" SET "serviceMode" = 'VENDOR' WHERE "vendorId" IS NOT NULL;
CREATE INDEX "maintenance_work_orders_responsibleId_idx" ON "maintenance_work_orders"("responsibleId");
CREATE INDEX "maintenance_work_orders_scheduleId_idx"    ON "maintenance_work_orders"("scheduleId");
-- one open service work order per schedule (Schedule Service twice returns the same one)
CREATE UNIQUE INDEX "maintenance_work_orders_one_open_per_schedule" ON "maintenance_work_orders"("scheduleId")
  WHERE "scheduleId" IS NOT NULL AND "status" NOT IN ('COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED');

-- parts used: the existing, already-written table gets a unit cost and an optional machine part link
ALTER TABLE "work_order_repair_parts"
  ADD COLUMN "unitCost"      DECIMAL(12,2),
  ADD COLUMN "machinePartId" TEXT,
  ADD CONSTRAINT "work_order_repair_parts_machinePartId_fkey" FOREIGN KEY ("machinePartId") REFERENCES "machine_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "work_order_repair_parts_unitCost_chk" CHECK ("unitCost" IS NULL OR "unitCost" >= 0);

CREATE TABLE "machine_documents" (
  "id"          TEXT PRIMARY KEY,
  "firmId"      BIGINT,
  "machineId"   TEXT NOT NULL,
  "workOrderId" TEXT,
  "type"        "MachineDocType" NOT NULL DEFAULT 'OTHER',
  "title"       TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "issuedAt"    DATE,
  "expiresAt"   DATE,
  "createdById" BIGINT,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt"    TIMESTAMPTZ(3),
  "voidedById"  BIGINT,
  "voidReason"  TEXT,
  CONSTRAINT "machine_documents_firmId_fkey"      FOREIGN KEY ("firmId")      REFERENCES "firm"("id")                         ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_documents_machineId_fkey"   FOREIGN KEY ("machineId")   REFERENCES "machines"("id")                     ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "machine_documents_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "maintenance_work_orders"("id")      ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id")                         ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_documents_voidedById_fkey"  FOREIGN KEY ("voidedById")  REFERENCES "user"("id")                         ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_documents_dates_chk" CHECK ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" >= "issuedAt")
);
CREATE INDEX "machine_documents_machineId_type_idx" ON "machine_documents"("machineId", "type");

-- backfill from Machine.documentUrls (kept in place, now deprecated). An element is either a JSON string {url, description} or a plain URL.
-- The hardcoded "standard documents" of the old screen were invented sample data and are NOT migrated.
DO $$
DECLARE
  m RECORD;
  e TEXT;
  j JSONB;
  doc_url TEXT;
  doc_title TEXT;
  doc_type "MachineDocType";
BEGIN
  FOR m IN SELECT "id", "firmId", "documentUrls" FROM "machines" WHERE "documentUrls" IS NOT NULL AND array_length("documentUrls", 1) > 0 LOOP
    FOREACH e IN ARRAY m."documentUrls" LOOP
      BEGIN
        IF e IS NULL OR btrim(e) = '' THEN CONTINUE; END IF;
        IF left(btrim(e), 1) = '{' THEN
          j := e::JSONB;
          doc_url := j->>'url';
          doc_title := coalesce(nullif(j->>'description', ''), doc_url);
        ELSE
          doc_url := btrim(e);
          doc_title := doc_url;
        END IF;
        IF doc_url IS NULL OR doc_url = '' THEN CONTINUE; END IF;
        doc_type := CASE
          WHEN doc_title ILIKE '%rc%book%' OR doc_title ILIKE '%registration%' THEN 'RC_BOOK'
          WHEN doc_title ILIKE '%insur%'                                       THEN 'INSURANCE'
          WHEN doc_title ILIKE '%puc%' OR doc_title ILIKE '%pollution%'        THEN 'PUC'
          WHEN doc_title ILIKE '%fitness%'                                     THEN 'FITNESS'
          WHEN doc_title ILIKE '%licen%'                                       THEN 'OPERATOR_LICENSE'
          WHEN doc_title ILIKE '%service%' OR doc_title ILIKE '%maintenance%'  THEN 'SERVICE_REPORT'
          ELSE 'OTHER' END;
        INSERT INTO "machine_documents" ("id", "firmId", "machineId", "type", "title", "url")
        VALUES (gen_random_uuid()::TEXT, m."firmId", m."id", doc_type, doc_title, doc_url);
      EXCEPTION WHEN OTHERS THEN
        -- unparseable element: keep it as a plain document rather than losing it
        INSERT INTO "machine_documents" ("id", "firmId", "machineId", "type", "title", "url")
        VALUES (gen_random_uuid()::TEXT, m."firmId", m."id", 'OTHER', left(e, 200), e);
      END;
    END LOOP;
  END LOOP;
END $$;

-- ===========================================================================
-- A.3 ASSIGNMENTS, OPERATORS, TRANSFERS
-- ===========================================================================
CREATE TABLE "machine_assignments" (
  "id"               TEXT PRIMARY KEY,
  "machineId"        TEXT NOT NULL,
  "firmId"           BIGINT NOT NULL,
  "siteLocationId"   BIGINT,
  "startedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedReturnAt" DATE,
  "endedAt"          TIMESTAMPTZ(3),
  "endReason"        TEXT,                       -- TRANSFER | RELEASED | RETURNED_TO_VENDOR | OTHER
  "responsibleUserId" BIGINT,
  "note"             TEXT,
  "createdById"      BIGINT,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machine_assignments_machineId_fkey"      FOREIGN KEY ("machineId")      REFERENCES "machines"("id")              ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machine_assignments_firmId_fkey"         FOREIGN KEY ("firmId")         REFERENCES "firm"("id")                  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_assignments_siteLocationId_fkey" FOREIGN KEY ("siteLocationId") REFERENCES "site_location_details"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_assignments_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "user"("id")              ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_assignments_createdById_fkey"    FOREIGN KEY ("createdById")    REFERENCES "user"("id")                  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_assignments_period_chk" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt")
);
-- one ACTIVE assignment per machine, enforced by the database
CREATE UNIQUE INDEX "machine_assignments_one_active_per_machine" ON "machine_assignments"("machineId") WHERE "endedAt" IS NULL;
CREATE INDEX "machine_assignments_firmId_endedAt_idx" ON "machine_assignments"("firmId", "endedAt");
CREATE INDEX "machine_assignments_machineId_startedAt_idx" ON "machine_assignments"("machineId", "startedAt");

CREATE TABLE "machine_operator_assignments" (
  "id"          TEXT PRIMARY KEY,
  "machineId"   TEXT NOT NULL,
  "userId"      BIGINT NOT NULL,
  "shift"       "WorkShift",
  "validFrom"   DATE NOT NULL DEFAULT CURRENT_DATE,
  "validTill"   DATE,
  "endedAt"     TIMESTAMPTZ(3),
  "createdById" BIGINT,
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machine_operator_assignments_machineId_fkey"   FOREIGN KEY ("machineId")   REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machine_operator_assignments_userId_fkey"      FOREIGN KEY ("userId")      REFERENCES "user"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_operator_assignments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id")     ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_operator_assignments_period_chk" CHECK ("validTill" IS NULL OR "validTill" >= "validFrom")
);
-- allow multiple active operators per machine, prevent assigning the same user twice while active
CREATE UNIQUE INDEX "machine_operator_assignments_machine_user_active" ON "machine_operator_assignments"("machineId", "userId") WHERE "endedAt" IS NULL;
CREATE INDEX "machine_operator_assignments_userId_endedAt_idx" ON "machine_operator_assignments"("userId", "endedAt");

CREATE TABLE "machine_transfers" (
  "id"                 TEXT PRIMARY KEY,
  "transferNumber"     TEXT NOT NULL,
  "machineId"          TEXT NOT NULL,
  "fromAssignmentId"   TEXT,
  "fromFirmId"         BIGINT NOT NULL,
  "fromSiteLocationId" BIGINT,
  "toFirmId"           BIGINT NOT NULL,
  "toSiteLocationId"   BIGINT,
  "status"             "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedById"      BIGINT,
  "approvedById"       BIGINT,
  "requestedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt"       TIMESTAMPTZ(3),
  "transporter"        TEXT,
  "vehicleNo"          TEXT,
  "lrRef"              TEXT,
  "eta"                DATE,
  "receivedAt"         TIMESTAMPTZ(3),
  "receivedById"       BIGINT,
  "cancelReason"       TEXT,
  "note"               TEXT,
  CONSTRAINT "machine_transfers_machineId_fkey"        FOREIGN KEY ("machineId")        REFERENCES "machines"("id")            ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_fromAssignmentId_fkey" FOREIGN KEY ("fromAssignmentId") REFERENCES "machine_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_fromFirmId_fkey"       FOREIGN KEY ("fromFirmId")       REFERENCES "firm"("id")                ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_toFirmId_fkey"         FOREIGN KEY ("toFirmId")         REFERENCES "firm"("id")                ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_requestedById_fkey"    FOREIGN KEY ("requestedById")    REFERENCES "user"("id")                ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_approvedById_fkey"     FOREIGN KEY ("approvedById")     REFERENCES "user"("id")                ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_receivedById_fkey"     FOREIGN KEY ("receivedById")     REFERENCES "user"("id")                ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "machine_transfers_cancel_chk" CHECK ("status" <> 'CANCELLED' OR length(btrim(coalesce("cancelReason", ''))) > 0),
  CONSTRAINT "machine_transfers_dispatch_chk" CHECK ("status" NOT IN ('IN_TRANSIT', 'RECEIVED') OR "dispatchedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "machine_transfers_transferNumber_key" ON "machine_transfers"("transferNumber");
-- one open transfer per machine
CREATE UNIQUE INDEX "machine_transfers_one_open_per_machine" ON "machine_transfers"("machineId") WHERE "status" IN ('REQUESTED', 'APPROVED', 'IN_TRANSIT');
CREATE INDEX "machine_transfers_toFirmId_status_idx"   ON "machine_transfers"("toFirmId", "status");
CREATE INDEX "machine_transfers_fromFirmId_status_idx" ON "machine_transfers"("fromFirmId", "status");

CREATE TABLE "machine_transfer_events" (
  "id"         TEXT PRIMARY KEY,
  "transferId" TEXT NOT NULL,
  "fromStatus" "TransferStatus",
  "toStatus"   "TransferStatus" NOT NULL,
  "actorId"    BIGINT,
  "note"       TEXT,
  "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machine_transfer_events_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "machine_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machine_transfer_events_actorId_fkey"    FOREIGN KEY ("actorId")    REFERENCES "user"("id")              ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "machine_transfer_events_transferId_createdAt_idx" ON "machine_transfer_events"("transferId", "createdAt");

-- backfill: one active assignment per live machine that has a firm (the working project = the owning firm until a transfer).
-- Machines with no firm get none: they show as "no project" until an admin assigns them.
INSERT INTO "machine_assignments" ("id", "machineId", "firmId", "siteLocationId", "startedAt", "expectedReturnAt", "responsibleUserId")
SELECT gen_random_uuid()::TEXT, m."id", m."firmId", m."siteLocationId", m."createdAt",
       CASE WHEN m."ownershipType" = 'RENTED' THEN (m."rentalEndAt" AT TIME ZONE 'Asia/Kolkata')::DATE ELSE NULL END,
       m."defaultResponsibleId"
FROM "machines" m
WHERE m."firmId" IS NOT NULL AND m."isActive" = true AND m."status" <> 'DECOMMISSIONED';

COMMIT;
