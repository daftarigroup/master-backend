-- Rollback of fleet_v4_documents. Documents created only through v4 (operator-owned, no machine) are lost; machine documents keep their v3 columns.
BEGIN;

DELETE FROM "machine_documents" WHERE "machineId" IS NULL;
-- rows created after v4 have no legacy url/expiry: carry them back so nothing is blank
UPDATE "machine_documents" SET "expiresAt" = COALESCE("expiresAt", "validTill");
UPDATE "machine_documents" d SET "url" = f."url"
FROM (SELECT DISTINCT ON ("documentId") "documentId", "url" FROM "machine_document_files" ORDER BY "documentId", "sortOrder") f
WHERE d."id" = f."documentId" AND d."url" IS NULL;
DELETE FROM "machine_documents" WHERE "url" IS NULL;

ALTER TABLE "fleet_settings" DROP CONSTRAINT "fleet_settings_docWindow_chk", DROP COLUMN "documentExpiryWindowDays";

DROP TABLE "machine_document_events";
DROP TABLE "machine_document_files";

DROP INDEX "machine_documents_machine_type_valid_idx";
DROP INDEX "machine_documents_validTill_idx";
DROP INDEX "machine_documents_firm_valid_idx";
DROP INDEX "machine_documents_ownerUserId_idx";
DROP INDEX "machine_documents_firm_clientReq_key";
DROP INDEX "machine_documents_sourceRef_key";

ALTER TABLE "machine_documents"
  DROP CONSTRAINT "machine_documents_documentTypeId_fkey",
  DROP CONSTRAINT "machine_documents_ownerUserId_fkey",
  DROP CONSTRAINT "machine_documents_renewsDocumentId_fkey",
  DROP CONSTRAINT "machine_documents_owner_chk",
  DROP CONSTRAINT "machine_documents_valid_chk",
  DROP CONSTRAINT "machine_documents_amount_chk",
  DROP COLUMN "documentTypeId", DROP COLUMN "ownerType", DROP COLUMN "ownerUserId", DROP COLUMN "documentNumber",
  DROP COLUMN "issuer", DROP COLUMN "validFrom", DROP COLUMN "validTill", DROP COLUMN "amount", DROP COLUMN "remarks",
  DROP COLUMN "sourceType", DROP COLUMN "sourceRef", DROP COLUMN "clientRequestId", DROP COLUMN "renewsDocumentId", DROP COLUMN "updatedAt",
  ALTER COLUMN "machineId" SET NOT NULL,
  ALTER COLUMN "url" SET NOT NULL;

DROP TABLE "document_types";
DROP TYPE "DocEvent";
DROP TYPE "DocSource";
DROP TYPE "DocOwnerType";
DROP TYPE "DocApplies";
DROP TYPE "DocValidity";
DROP TYPE "DocCategory";

COMMIT;
