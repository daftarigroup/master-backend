-- Item-wise approval and PO tracking on pms_indent_item
ALTER TABLE "pms_indent_item"
  ADD COLUMN "approval_status" TEXT,
  ADD COLUMN "approved_rate" DECIMAL(15,2),
  ADD COLUMN "approved_vendor_name" TEXT,
  ADD COLUMN "po_number" TEXT;

-- Backfill: indents that are already past management approval keep working item by item
UPDATE "pms_indent_item" i
SET "approval_status" = CASE WHEN p."stage" = 'Rejected' THEN 'Rejected' ELSE 'Approved' END,
    "approved_rate" = p."approved_rate",
    "approved_vendor_name" = p."approved_vendor_name"
FROM "pms_indent" p
WHERE i."indent_id" = p."id" AND p."stage" IN ('ManagementApproved', 'POCreated', 'Rejected') AND p."management_approved_at" IS NOT NULL;

UPDATE "pms_indent_item" i
SET "po_number" = (SELECT po."po_number" FROM "pms_po" po WHERE po."indent_id" = i."indent_id" ORDER BY po."id" LIMIT 1)
FROM "pms_indent" p
WHERE i."indent_id" = p."id" AND p."stage" = 'POCreated' AND i."approval_status" = 'Approved';
