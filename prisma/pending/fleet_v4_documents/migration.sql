-- fleet_v4_documents: one document model for machines and operators (types, files, audit events, expiry window)
-- Additive only (no DROP). Builds on fleet_v1, fleet_v2_cost and fleet_v3_ops. Re-runnable backfill. Rollback: down.sql
BEGIN;

CREATE TYPE "DocCategory"  AS ENUM ('COMPLIANCE', 'OPERATOR', 'PURCHASE', 'RENTAL', 'SERVICE', 'OTHER');
CREATE TYPE "DocValidity"  AS ENUM ('REQUIRED', 'OPTIONAL', 'NONE');
CREATE TYPE "DocApplies"   AS ENUM ('OWNED', 'RENTED', 'BOTH');
CREATE TYPE "DocOwnerType" AS ENUM ('MACHINE', 'OPERATOR');
CREATE TYPE "DocSource"    AS ENUM ('UPLOAD', 'WORK_ORDER', 'MIGRATED');
CREATE TYPE "DocEvent"     AS ENUM ('CREATED', 'UPDATED', 'FILE_ADDED', 'FILE_REPLACED', 'VOIDED', 'DOWNLOADED');

-- ---------------------------------------------------------------------------
-- document types (firmId NULL = system type; firms can add their own)
-- ---------------------------------------------------------------------------
CREATE TABLE "document_types" (
  "id"                 TEXT PRIMARY KEY,
  "firmId"             BIGINT,
  "code"               TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "category"           "DocCategory" NOT NULL,
  "hasValidity"        "DocValidity" NOT NULL DEFAULT 'NONE',
  "appliesTo"          "DocApplies" NOT NULL DEFAULT 'BOTH',
  "machineCategories"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "singleCurrent"      BOOLEAN NOT NULL DEFAULT FALSE,
  "costSensitive"      BOOLEAN NOT NULL DEFAULT FALSE,
  "personal"           BOOLEAN NOT NULL DEFAULT FALSE,
  "allowMultipleFiles" BOOLEAN NOT NULL DEFAULT FALSE,
  "expiryLeadDays"     INTEGER,
  "active"             BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_types_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firm"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_types_lead_chk" CHECK ("expiryLeadDays" IS NULL OR ("expiryLeadDays" BETWEEN 1 AND 365))
);
CREATE UNIQUE INDEX "document_types_firm_code_key" ON "document_types"(COALESCE("firmId", 0), "code");

INSERT INTO "document_types" ("id", "code", "name", "category", "hasValidity", "appliesTo", "singleCurrent", "costSensitive", "personal", "allowMultipleFiles", "sortOrder") VALUES
  ('dt_rc_book',          'RC_BOOK',           'RC Book',                                   'COMPLIANCE', 'OPTIONAL', 'BOTH',   TRUE,  FALSE, FALSE, FALSE, 10),
  ('dt_insurance',        'INSURANCE',         'Insurance Certificate',                     'COMPLIANCE', 'REQUIRED', 'BOTH',   TRUE,  FALSE, FALSE, FALSE, 20),
  ('dt_puc',              'PUC',               'Pollution Under Control',                   'COMPLIANCE', 'REQUIRED', 'BOTH',   TRUE,  FALSE, FALSE, FALSE, 30),
  ('dt_fitness',          'FITNESS',           'Fitness Certificate',                       'COMPLIANCE', 'REQUIRED', 'BOTH',   TRUE,  FALSE, FALSE, FALSE, 40),
  ('dt_road_tax',         'ROAD_TAX',          'Road Tax',                                  'COMPLIANCE', 'REQUIRED', 'BOTH',   TRUE,  FALSE, FALSE, FALSE, 50),
  ('dt_permit',           'PERMIT',            'Permit',                                    'COMPLIANCE', 'REQUIRED', 'BOTH',   TRUE,  FALSE, FALSE, FALSE, 60),
  ('dt_load_test',        'LOAD_TEST',         'Statutory inspection / load-test certificate', 'COMPLIANCE', 'REQUIRED', 'BOTH', TRUE,  FALSE, FALSE, FALSE, 70),
  ('dt_operator_licence', 'OPERATOR_LICENSE',  'Operator Licence',                          'OPERATOR',   'REQUIRED', 'BOTH',   TRUE,  FALSE, TRUE,  FALSE, 80),
  ('dt_purchase_invoice', 'PURCHASE_INVOICE',  'Purchase Invoice',                          'PURCHASE',   'NONE',     'OWNED',  FALSE, TRUE,  FALSE, FALSE, 90),
  ('dt_warranty_card',    'WARRANTY_CARD',     'Warranty Card',                             'PURCHASE',   'NONE',     'OWNED',  FALSE, FALSE, FALSE, FALSE, 100),
  ('dt_delivery_challan', 'DELIVERY_CHALLAN',  'Delivery Challan',                          'PURCHASE',   'NONE',     'OWNED',  FALSE, FALSE, FALSE, FALSE, 110),
  ('dt_manual',           'MANUAL',            'Manual / Spec sheet',                       'PURCHASE',   'NONE',     'OWNED',  FALSE, FALSE, FALSE, FALSE, 120),
  ('dt_rental_agreement', 'RENTAL_AGREEMENT',  'Rental Agreement',                          'RENTAL',     'REQUIRED', 'RENTED', TRUE,  TRUE,  FALSE, FALSE, 130),
  ('dt_handover_challan', 'HANDOVER_CHALLAN',  'Hand-over Challan',                         'RENTAL',     'NONE',     'RENTED', FALSE, FALSE, FALSE, FALSE, 140),
  ('dt_offhire_note',     'OFFHIRE_NOTE',      'Off-hire / Return Note',                    'RENTAL',     'NONE',     'RENTED', FALSE, FALSE, FALSE, FALSE, 150),
  ('dt_rental_invoice',   'RENTAL_INVOICE',    'Rental Invoice',                            'RENTAL',     'NONE',     'RENTED', FALSE, TRUE,  FALSE, FALSE, 160),
  ('dt_service_report',   'SERVICE_REPORT',    'Service Report',                            'SERVICE',    'NONE',     'BOTH',   FALSE, FALSE, FALSE, FALSE, 170),
  ('dt_job_card',         'JOB_CARD',          'Job Card',                                  'SERVICE',    'NONE',     'BOTH',   FALSE, FALSE, FALSE, FALSE, 180),
  ('dt_vendor_bill',      'VENDOR_BILL',       'Vendor Bill',                               'SERVICE',    'NONE',     'BOTH',   FALSE, TRUE,  FALSE, FALSE, 190),
  ('dt_maint_photos',     'MAINTENANCE_PHOTOS','Maintenance Photos',                        'SERVICE',    'NONE',     'BOTH',   FALSE, FALSE, FALSE, TRUE,  200),
  ('dt_other',            'OTHER',             'Other',                                     'OTHER',      'OPTIONAL', 'BOTH',   FALSE, FALSE, FALSE, FALSE, 900);

-- ---------------------------------------------------------------------------
-- machine_documents: extend the v3 table
-- ---------------------------------------------------------------------------
ALTER TABLE "machine_documents"
  ADD COLUMN "documentTypeId"   TEXT,
  ADD COLUMN "ownerType"        "DocOwnerType" NOT NULL DEFAULT 'MACHINE',
  ADD COLUMN "ownerUserId"      BIGINT,
  ADD COLUMN "documentNumber"   TEXT,
  ADD COLUMN "issuer"           TEXT,
  ADD COLUMN "validFrom"        DATE,
  ADD COLUMN "validTill"        DATE,
  ADD COLUMN "amount"           DECIMAL(14,2),
  ADD COLUMN "remarks"          TEXT,
  ADD COLUMN "sourceType"       "DocSource" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "sourceRef"        TEXT,
  ADD COLUMN "clientRequestId"  TEXT,
  ADD COLUMN "renewsDocumentId" TEXT,
  ADD COLUMN "updatedAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "machineId" DROP NOT NULL,   -- operator-owned documents have no machine
  ALTER COLUMN "url"       DROP NOT NULL;   -- files live in machine_document_files; url/type/expiresAt are deprecated

ALTER TABLE "machine_documents"
  ADD CONSTRAINT "machine_documents_documentTypeId_fkey"   FOREIGN KEY ("documentTypeId")   REFERENCES "document_types"("id")    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "machine_documents_ownerUserId_fkey"      FOREIGN KEY ("ownerUserId")      REFERENCES "user"("id")              ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "machine_documents_renewsDocumentId_fkey" FOREIGN KEY ("renewsDocumentId") REFERENCES "machine_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "machine_documents_owner_chk"  CHECK ("machineId" IS NOT NULL OR "ownerUserId" IS NOT NULL),
  ADD CONSTRAINT "machine_documents_valid_chk"  CHECK ("validFrom" IS NULL OR "validTill" IS NULL OR "validTill" >= "validFrom"),
  ADD CONSTRAINT "machine_documents_amount_chk" CHECK ("amount" IS NULL OR "amount" >= 0);

-- map the old enum onto the new types, copy expiry
UPDATE "machine_documents" d SET
  "documentTypeId" = t."id",
  "validTill"      = COALESCE(d."validTill", d."expiresAt"),
  "validFrom"      = COALESCE(d."validFrom", d."issuedAt"),
  "sourceType"     = CASE WHEN d."createdById" IS NULL THEN 'MIGRATED'::"DocSource" ELSE d."sourceType" END,
  "sourceRef"      = COALESCE(d."sourceRef", 'mdu:' || d."id")
FROM "document_types" t
WHERE d."documentTypeId" IS NULL AND t."firmId" IS NULL AND t."code" = CASE d."type"::TEXT
  WHEN 'BILL' THEN 'VENDOR_BILL' ELSE d."type"::TEXT END;

CREATE INDEX "machine_documents_machine_type_valid_idx" ON "machine_documents"("machineId", "documentTypeId", "validTill" DESC) WHERE "voidedAt" IS NULL;
CREATE INDEX "machine_documents_validTill_idx"          ON "machine_documents"("validTill") WHERE "voidedAt" IS NULL;
CREATE INDEX "machine_documents_firm_valid_idx"         ON "machine_documents"("firmId", "validTill") WHERE "voidedAt" IS NULL;
CREATE INDEX "machine_documents_ownerUserId_idx"        ON "machine_documents"("ownerUserId") WHERE "ownerUserId" IS NOT NULL;
CREATE UNIQUE INDEX "machine_documents_firm_clientReq_key" ON "machine_documents"("firmId", "clientRequestId") WHERE "clientRequestId" IS NOT NULL;
CREATE UNIQUE INDEX "machine_documents_sourceRef_key"      ON "machine_documents"("sourceRef") WHERE "sourceRef" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- files (a photo set is one document with many files)
-- ---------------------------------------------------------------------------
CREATE TABLE "machine_document_files" (
  "id"           TEXT PRIMARY KEY,
  "documentId"   TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "url"          TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType"     TEXT,
  "sizeBytes"    INTEGER,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "machine_document_files_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "machine_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machine_document_files_size_chk" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0)
);
CREATE UNIQUE INDEX "machine_document_files_doc_sort_key" ON "machine_document_files"("documentId", "sortOrder");
CREATE INDEX "machine_document_files_key_idx" ON "machine_document_files"("key");

-- ---------------------------------------------------------------------------
-- audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE "machine_document_events" (
  "id"         TEXT PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "event"      "DocEvent" NOT NULL,
  "actorId"    BIGINT,
  "at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "meta"       JSONB,
  CONSTRAINT "machine_document_events_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "machine_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "machine_document_events_actorId_fkey"    FOREIGN KEY ("actorId")    REFERENCES "user"("id")              ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "machine_document_events_doc_idx" ON "machine_document_events"("documentId", "at");

-- ---------------------------------------------------------------------------
-- firm setting
-- ---------------------------------------------------------------------------
ALTER TABLE "fleet_settings"
  ADD COLUMN "documentExpiryWindowDays" INTEGER NOT NULL DEFAULT 30,
  ADD CONSTRAINT "fleet_settings_docWindow_chk" CHECK ("documentExpiryWindowDays" BETWEEN 1 AND 365);

-- ---------------------------------------------------------------------------
-- backfill (re-runnable: unique sourceRef + NOT EXISTS guards). Old columns stay, deprecated.
-- ---------------------------------------------------------------------------
-- work-order service document / bill / photos
INSERT INTO "machine_documents" ("id", "firmId", "machineId", "workOrderId", "type", "documentTypeId", "title", "sourceType", "sourceRef", "createdAt", "issuedAt")
SELECT gen_random_uuid()::TEXT, wo."firmId", wo."machineId", wo."id",
       CASE x.f WHEN 'billUrl' THEN 'BILL'::"MachineDocType" WHEN 'documentUrl' THEN 'SERVICE_REPORT'::"MachineDocType" ELSE 'OTHER'::"MachineDocType" END,
       t."id",
       CASE x.f WHEN 'billUrl' THEN 'Vendor bill' WHEN 'documentUrl' THEN 'Service document' ELSE 'Service photos' END || ' (' || COALESCE(wo."workOrderCode", wo."id") || ')',
       'MIGRATED', 'wo:' || wo."id" || ':' || x.f, wo."createdAt", wo."createdAt"::DATE
FROM "maintenance_work_orders" wo
CROSS JOIN LATERAL (VALUES ('documentUrl', wo."documentUrl"), ('billUrl', wo."billUrl"), ('photoUrl', wo."photoUrl")) AS x(f, u)
JOIN "document_types" t ON t."firmId" IS NULL AND t."code" = CASE x.f WHEN 'billUrl' THEN 'VENDOR_BILL' WHEN 'documentUrl' THEN 'SERVICE_REPORT' ELSE 'MAINTENANCE_PHOTOS' END
WHERE x.u IS NOT NULL AND btrim(x.u) <> ''
  AND NOT EXISTS (SELECT 1 FROM "machine_documents" d WHERE d."machineId" = wo."machineId" AND d."url" = x.u)
ON CONFLICT DO NOTHING;

-- keep the url on the file row; the temporary document.url carries it for the file insert below
UPDATE "machine_documents" d SET "url" = x.u
FROM (
  SELECT 'wo:' || wo."id" || ':' || f AS ref, u
  FROM "maintenance_work_orders" wo
  CROSS JOIN LATERAL (VALUES ('documentUrl', wo."documentUrl"), ('billUrl', wo."billUrl"), ('photoUrl', wo."photoUrl")) AS v(f, u)
  WHERE u IS NOT NULL AND btrim(u) <> ''
) x
WHERE d."sourceRef" = x.ref AND d."url" IS NULL;

-- plan documents
INSERT INTO "machine_documents" ("id", "firmId", "machineId", "type", "documentTypeId", "title", "url", "sourceType", "sourceRef")
SELECT gen_random_uuid()::TEXT, p."firmId", p."machineId", 'OTHER', t."id", 'Plan document (' || COALESCE(p."planCode", p."id") || ')', p."documentUrl", 'MIGRATED', 'plan:' || p."id" || ':documentUrl'
FROM "maintenance_plans" p
JOIN "document_types" t ON t."firmId" IS NULL AND t."code" = 'OTHER'
WHERE p."documentUrl" IS NOT NULL AND btrim(p."documentUrl") <> ''
  AND NOT EXISTS (SELECT 1 FROM "machine_documents" d WHERE d."machineId" = p."machineId" AND d."url" = p."documentUrl")
ON CONFLICT DO NOTHING;

-- one file row per document that still has a legacy url
INSERT INTO "machine_document_files" ("id", "documentId", "key", "url", "originalName", "mimeType", "sortOrder")
SELECT gen_random_uuid()::TEXT, d."id",
       regexp_replace(d."url", '^https?://[^/]+/', ''),
       d."url",
       COALESCE(NULLIF(regexp_replace(split_part(d."url", '?', 1), '^.*/', ''), ''), 'file'),
       CASE lower(regexp_replace(split_part(d."url", '?', 1), '^.*\.', ''))
         WHEN 'pdf' THEN 'application/pdf' WHEN 'jpg' THEN 'image/jpeg' WHEN 'jpeg' THEN 'image/jpeg'
         WHEN 'png' THEN 'image/png' WHEN 'webp' THEN 'image/webp' ELSE NULL END,
       0
FROM "machine_documents" d
WHERE d."url" IS NOT NULL AND btrim(d."url") <> ''
ON CONFLICT DO NOTHING;

-- manuals / spec sheets uploaded through the old machine form were guessed as service reports
UPDATE "machine_documents" d SET "documentTypeId" = t."id", "title" = CASE WHEN d."url" ILIKE '%/specs/%' THEN 'Specification sheet' ELSE 'Manual' END
FROM "document_types" t
WHERE t."firmId" IS NULL AND t."code" = 'MANUAL' AND d."sourceType" = 'MIGRATED' AND d."sourceRef" LIKE 'mdu:%' AND d."url" ~* '/(manuals|specs)/';

-- anything without a type (should be nothing) falls back to Other
UPDATE "machine_documents" d SET "documentTypeId" = t."id"
FROM "document_types" t WHERE d."documentTypeId" IS NULL AND t."firmId" IS NULL AND t."code" = 'OTHER';
ALTER TABLE "machine_documents" ALTER COLUMN "documentTypeId" SET NOT NULL;

COMMIT;
