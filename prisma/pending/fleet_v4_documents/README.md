# fleet_v4_documents: one document model for machines and operators

Design and log: [md/EQUIPMENT_DOCUMENTS_PLAN_AND_CONTEXT.md](../../../../md/EQUIPMENT_DOCUMENTS_PLAN_AND_CONTEXT.md). Builds on `fleet_v1`, `fleet_v2_cost` and `fleet_v3_ops`.

**Status (2026-10-01): APPLIED to the local `master_db` only (localhost:5432; a custom-format dump taken first is in `backups_docs_v1/db/master_db_before_v4.dump`), `schema.prisma` updated, client regenerated. NOT applied to the AWS RDS database.** RDS needs `fleet_v1`, `fleet_v2_cost`, `fleet_v3_ops` and `fleet_v4_documents`, in that order, only on an explicit go-ahead.

| File | What it is |
|---|---|
| `migration.sql` | Additive, one transaction: 6 enums, `document_types` (seeded with 21 system types), `machine_document_files`, `machine_document_events`; `machine_documents` gains `documentTypeId`, owner (machine or operator), document no., issuer, `validFrom` / `validTill`, amount, remarks, `sourceType` / `sourceRef`, `clientRequestId`, `renewsDocumentId`, `updatedAt`; `machineId` and `url` become nullable; `fleet_settings.documentExpiryWindowDays` (default 30); indexes; backfill. |
| `down.sql` | Rollback. Drops everything v4 added. Operator-owned documents (no machine) are lost; machine documents keep their v3 columns (`url` and `expiresAt` are restored from the files / `validTill`). |

## Backfill (re-runnable)
- Existing v3 rows get a `documentTypeId` from the old enum (`BILL` becomes Vendor Bill), `validTill` from `expiresAt`, `validFrom` from `issuedAt`, a file row from `url`, and `sourceRef = mdu:<id>`.
- Work-order `documentUrl` / `billUrl` / `photoUrl` and maintenance plan `documentUrl` become documents (`sourceType = MIGRATED`, `sourceRef = wo:<id>:<field>` / `plan:<id>:documentUrl`). A file already present on the same machine is not added twice.
- Manuals / spec sheets uploaded through the old machine form are retyped to Manual.
- Unique indexes on `sourceRef` and `(firmId, clientRequestId)` make a second run a no-op (tested: running the backfill twice leaves the counts unchanged).
- The old columns (`Machine.documentUrls`, `maintenance_work_orders.documentUrl/billUrl/photoUrl`, `machine_documents.type/url/expiresAt`) stay, deprecated. `repair_dispatches.transportImage`, `repair_receivings.billImage` and `repair_indents.image` belong to the legacy repair module and are not migrated.

## Database-only guards
Unique `(COALESCE(firmId,0), code)` on document types; unique partial indexes on `machine_documents` (`sourceRef`, `(firmId, clientRequestId)`); CHECKs (`validTill >= validFrom`, `amount >= 0`, a document has a machine or an owner, window 1-365); partial indexes for `(machineId, documentTypeId, validTill DESC)`, `validTill` and `(firmId, validTill)` where not voided.

## Verified (scratch PostgreSQL and local master_db, never RDS)
Applied to the throwaway test database as part of the test setup, and to local `master_db` (7 documents backfilled, none lost, idempotent); `documents.api.test.ts` (23 tests) passes.
