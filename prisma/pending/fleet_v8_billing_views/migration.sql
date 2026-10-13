-- fleet_v8_billing_views: read-only, machine-based billing data (Phase 7 of the Store x Asset x M&R integration).
-- Views only: no table changes, no copies of data. Idempotent (CREATE OR REPLACE). Rollback: down.sql
--
-- billing_diesel_v        live diesel log rows (voidedAt null; any source, as the cost engine counts them)
-- billing_repair_v        REPAIR / BREAKDOWN work orders that are completed, or outsourced and RECEIVED / PAID
-- billing_maintenance_v   SCHEDULED / ONE_TIME work orders, same rule
-- billing_parts_v         live spare-part issues to a work order (counted = false: the cost is already inside the job's cost)
-- billing_events_v        the four above, one common set of columns
--
-- counted = true when the row is counted in the machine's cost by the existing rule (fleet/cost/maintenanceCostProvider.ts):
-- cost not null, status COMPLETED / COMPLETED_LATE, and an outsourced job only once RECEIVED / PAID. Dates are IST dates.
-- taxPercent / taxAmount are reserved and always null for now.

CREATE OR REPLACE VIEW billing_diesel_v AS
SELECT
  'DIESEL'::text                        AS "eventType",
  d."id"                                AS "eventId",
  d."machineId"                         AS "machineId",
  m."assetCode"                         AS "machineCode",
  m."name"                              AS "machineName",
  d."firmId"                            AS "firmId",
  f."firm_name"                         AS "firmName",
  d."issueDate"                         AS "eventDate",
  'ISSUE'::text                         AS "docType",
  i."issue_no"                          AS "docNo",
  NULL::text                            AS "workOrderCode",
  NULL::text                            AS "vendorName",
  COALESCE(i."product_name", 'DIESEL')  AS "itemName",
  COALESCE(i."group_head", 'DIESEL')    AS "groupHead",
  'LTR'::text                           AS "uom",
  d."litres"::numeric                   AS "quantity",
  d."ratePerLitre"::numeric             AS "rate",
  d."amount"::numeric                   AS "amount",
  NULL::numeric                         AS "partsCost",
  NULL::numeric                         AS "labourCost",
  NULL::text                            AS "billNo",
  NULL::text                            AS "billUrl",
  NULL::timestamptz                     AS "paidAt",
  'IN_HOUSE'::text                      AS "serviceMode",
  d."source"::text                      AS "status",
  true                                  AS "counted",
  NULL::numeric                         AS "taxPercent",
  NULL::numeric                         AS "taxAmount",
  d."storeIssueId"                      AS "sourceIssueId",
  d."externalRef"::text                 AS "sourceRef"
FROM "diesel_logs" d
JOIN "machines" m ON m."id" = d."machineId"
LEFT JOIN "firm" f ON f."id" = d."firmId"
LEFT JOIN "issue" i ON i."id" = d."storeIssueId"
WHERE d."voidedAt" IS NULL AND d."machineId" IS NOT NULL;

CREATE OR REPLACE VIEW billing_repair_v AS
SELECT
  'REPAIR'::text                        AS "eventType",
  w."id"                                AS "eventId",
  w."machineId"                         AS "machineId",
  m."assetCode"                         AS "machineCode",
  m."name"                              AS "machineName",
  COALESCE(w."firmId", m."firmId")      AS "firmId",
  f."firm_name"                         AS "firmName",
  CASE WHEN w."outsourceStatus" IS NOT NULL
       THEN (COALESCE(w."receivedAt", w."completedAt") AT TIME ZONE 'Asia/Kolkata')::date
       ELSE (w."completedAt" AT TIME ZONE 'Asia/Kolkata')::date END AS "eventDate",
  'WORK_ORDER'::text                    AS "docType",
  w."workOrderCode"                     AS "docNo",
  w."workOrderCode"                     AS "workOrderCode",
  v."name"                              AS "vendorName",
  NULL::text                            AS "itemName",
  NULL::text                            AS "groupHead",
  NULL::text                            AS "uom",
  NULL::numeric                         AS "quantity",
  NULL::numeric                         AS "rate",
  w."cost"::numeric                     AS "amount",
  w."actualPartsCost"::numeric          AS "partsCost",
  w."actualLabourCost"::numeric         AS "labourCost",
  w."billNo"                            AS "billNo",
  w."billUrl"                           AS "billUrl",
  w."paidAt"                            AS "paidAt",
  CASE WHEN w."outsourceStatus" IS NOT NULL THEN 'OUTSOURCED' ELSE 'IN_HOUSE' END AS "serviceMode",
  w."status"::text || COALESCE(' / ' || w."outsourceStatus"::text, '') AS "status",
  (w."cost" IS NOT NULL AND w."status" IN ('COMPLETED', 'COMPLETED_LATE')
     AND ((w."outsourceStatus" IS NULL AND w."completedAt" IS NOT NULL)
          OR (w."outsourceStatus" IN ('RECEIVED', 'PAID') AND w."receivedAt" IS NOT NULL))) AS "counted",
  NULL::numeric                         AS "taxPercent",
  NULL::numeric                         AS "taxAmount",
  NULL::bigint                          AS "sourceIssueId",
  NULL::text                            AS "sourceRef"
FROM "maintenance_work_orders" w
JOIN "machines" m ON m."id" = w."machineId"
LEFT JOIN "firm" f ON f."id" = COALESCE(w."firmId", m."firmId")
LEFT JOIN "repair_vendors" v ON v."id" = w."vendorId"
WHERE w."type" IN ('REPAIR', 'BREAKDOWN')
  AND ((w."outsourceStatus" IS NULL AND w."status" IN ('COMPLETED', 'COMPLETED_LATE'))
       OR w."outsourceStatus" IN ('RECEIVED', 'PAID'));

CREATE OR REPLACE VIEW billing_maintenance_v AS
SELECT
  'MAINTENANCE'::text                   AS "eventType",
  w."id"                                AS "eventId",
  w."machineId"                         AS "machineId",
  m."assetCode"                         AS "machineCode",
  m."name"                              AS "machineName",
  COALESCE(w."firmId", m."firmId")      AS "firmId",
  f."firm_name"                         AS "firmName",
  CASE WHEN w."outsourceStatus" IS NOT NULL
       THEN (COALESCE(w."receivedAt", w."completedAt") AT TIME ZONE 'Asia/Kolkata')::date
       ELSE (w."completedAt" AT TIME ZONE 'Asia/Kolkata')::date END AS "eventDate",
  'WORK_ORDER'::text                    AS "docType",
  w."workOrderCode"                     AS "docNo",
  w."workOrderCode"                     AS "workOrderCode",
  v."name"                              AS "vendorName",
  NULL::text                            AS "itemName",
  NULL::text                            AS "groupHead",
  NULL::text                            AS "uom",
  NULL::numeric                         AS "quantity",
  NULL::numeric                         AS "rate",
  w."cost"::numeric                     AS "amount",
  w."actualPartsCost"::numeric          AS "partsCost",
  w."actualLabourCost"::numeric         AS "labourCost",
  w."billNo"                            AS "billNo",
  w."billUrl"                           AS "billUrl",
  w."paidAt"                            AS "paidAt",
  CASE WHEN w."outsourceStatus" IS NOT NULL THEN 'OUTSOURCED' ELSE 'IN_HOUSE' END AS "serviceMode",
  w."status"::text || COALESCE(' / ' || w."outsourceStatus"::text, '') AS "status",
  (w."cost" IS NOT NULL AND w."status" IN ('COMPLETED', 'COMPLETED_LATE')
     AND ((w."outsourceStatus" IS NULL AND w."completedAt" IS NOT NULL)
          OR (w."outsourceStatus" IN ('RECEIVED', 'PAID') AND w."receivedAt" IS NOT NULL))) AS "counted",
  NULL::numeric                         AS "taxPercent",
  NULL::numeric                         AS "taxAmount",
  NULL::bigint                          AS "sourceIssueId",
  NULL::text                            AS "sourceRef"
FROM "maintenance_work_orders" w
JOIN "machines" m ON m."id" = w."machineId"
LEFT JOIN "firm" f ON f."id" = COALESCE(w."firmId", m."firmId")
LEFT JOIN "repair_vendors" v ON v."id" = w."vendorId"
WHERE w."type" IN ('SCHEDULED', 'ONE_TIME')
  AND ((w."outsourceStatus" IS NULL AND w."status" IN ('COMPLETED', 'COMPLETED_LATE'))
       OR w."outsourceStatus" IN ('RECEIVED', 'PAID'));

CREATE OR REPLACE VIEW billing_parts_v AS
SELECT
  'PARTS'::text                         AS "eventType",
  p."id"                                AS "eventId",
  w."machineId"                         AS "machineId",
  m."assetCode"                         AS "machineCode",
  m."name"                              AS "machineName",
  COALESCE(w."firmId", m."firmId")      AS "firmId",
  f."firm_name"                         AS "firmName",
  COALESCE(i."planned1"::date, (p."createdAt" AT TIME ZONE 'Asia/Kolkata')::date) AS "eventDate",
  'ISSUE'::text                         AS "docType",
  i."issue_no"                          AS "docNo",
  w."workOrderCode"                     AS "workOrderCode",
  NULL::text                            AS "vendorName",
  r."itemName"                          AS "itemName",
  r."groupHead"                         AS "groupHead",
  r."uom"                               AS "uom",
  p."quantity"::numeric                 AS "quantity",
  p."unitCost"::numeric                 AS "rate",
  p."amount"::numeric                   AS "amount",
  NULL::numeric                         AS "partsCost",
  NULL::numeric                         AS "labourCost",
  NULL::text                            AS "billNo",
  NULL::text                            AS "billUrl",
  NULL::timestamptz                     AS "paidAt",
  'IN_HOUSE'::text                      AS "serviceMode",
  'ISSUED'::text                        AS "status",
  false                                 AS "counted",
  NULL::numeric                         AS "taxPercent",
  NULL::numeric                         AS "taxAmount",
  p."storeIssueId"                      AS "sourceIssueId",
  r."indentNumber"                      AS "sourceRef"
FROM "work_order_part_issues" p
JOIN "work_order_part_requirements" r ON r."id" = p."requirementId"
JOIN "maintenance_work_orders" w ON w."id" = p."workOrderId"
JOIN "machines" m ON m."id" = w."machineId"
LEFT JOIN "firm" f ON f."id" = COALESCE(w."firmId", m."firmId")
LEFT JOIN "issue" i ON i."id" = p."storeIssueId"
WHERE p."voidedAt" IS NULL;

CREATE OR REPLACE VIEW billing_events_v AS
SELECT * FROM billing_diesel_v
UNION ALL SELECT * FROM billing_repair_v
UNION ALL SELECT * FROM billing_maintenance_v
UNION ALL SELECT * FROM billing_parts_v;
