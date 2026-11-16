-- Work log approval removed: every pending log is treated as approved.
INSERT INTO "work_log_status_logs" ("id", "usageLogId", "fromStatus", "toStatus", "note", "createdAt")
SELECT 'wlsl_' || md5(random()::text || "id"), "id", 'PENDING', 'APPROVED', 'Approval removed: auto-approved', now()
FROM "machine_usage_logs" WHERE "status" = 'PENDING';

UPDATE "machine_usage_logs" SET "status" = 'APPROVED' WHERE "status" = 'PENDING';
