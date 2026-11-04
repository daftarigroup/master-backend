# pms_indent_po_v1

PMS indent → PO pipeline: backend for Indent Approval, Vendor Rate Update, Technical Approval, Management Approval, Pending PO, Create PO and PO History (`/api/pms/indents`, `/api/pms/pos`).

- Creates `pms_indent`, `pms_indent_item`, `pms_indent_vendor`, `pms_po`, `pms_po_item` when missing (they were in `schema.prisma` with no migration).
- Adds `pms_indent.selected_vendor_id` (FK `pms_indent_vendor.id`, `ON DELETE SET NULL`): the vendor picked at Technical Approval.
- Adds `pms_indent_vendor.quotation_filename`.
- `pms_po.indent_id` becomes nullable and its FK `ON DELETE SET NULL` (was `RESTRICT`), so a PO can be raised without an indent.
- Indexes on `pms_indent(stage)`, `pms_indent_vendor(indent_id)`, `pms_po(indent_id)`.
- Idempotent, no data changed. Needs `pms_project`.

**Not applied to any real database.** Tested only on a throwaway local Postgres (port 55432) built from `schema.prisma`: applied on top of the old tables (with rows) and on an empty database, twice each, then `prisma migrate diff` against `schema.prisma` came back empty; `down.sql` then `migration.sql` again also verified.

Apply when ready with `psql -v ON_ERROR_STOP=1 -f prisma/pending/pms_indent_po_v1/migration.sql`, then `npm run prisma:generate`. Take a backup first.

Rollback: `down.sql` (drops only the v1 columns and indexes; fails without changes if any PO has no indent).
