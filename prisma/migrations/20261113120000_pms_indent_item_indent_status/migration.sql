-- Item-wise decision at the Indent Approval stage (null = still pending that stage)
ALTER TABLE "pms_indent_item" ADD COLUMN "indent_status" TEXT;
UPDATE "pms_indent_item" i SET "indent_status" = CASE WHEN p."stage" = 'Pending' THEN NULL WHEN p."indent_status" = 'Rejected' THEN 'Rejected' ELSE 'Approved' END
FROM "pms_indent" p WHERE i."indent_id" = p."id";
