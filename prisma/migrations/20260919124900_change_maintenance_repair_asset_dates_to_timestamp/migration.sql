-- AlterTable: Change Date fields to Timestamp(3) for Asset, Machine, Maintenance, and Repair models
ALTER TABLE "assets" ALTER COLUMN "mfgDate" TYPE TIMESTAMP(3),
ALTER COLUMN "assetDate" TYPE TIMESTAMP(3),
ALTER COLUMN "warrantyEnd" TYPE TIMESTAMP(3),
ALTER COLUMN "amcEnd" TYPE TIMESTAMP(3),
ALTER COLUMN "lastMaintenanceDate" TYPE TIMESTAMP(3),
ALTER COLUMN "nextService" TYPE TIMESTAMP(3),
ALTER COLUMN "lastRepairDate" TYPE TIMESTAMP(3);

ALTER TABLE "machines" ALTER COLUMN "purchaseDate" TYPE TIMESTAMP(3),
ALTER COLUMN "installationDate" TYPE TIMESTAMP(3),
ALTER COLUMN "warrantyExpiry" TYPE TIMESTAMP(3);

ALTER TABLE "maintenance_plans" ALTER COLUMN "startDate" TYPE TIMESTAMP(3),
ALTER COLUMN "endDate" TYPE TIMESTAMP(3);

ALTER TABLE "maintenance_work_orders" ALTER COLUMN "scheduledDate" TYPE TIMESTAMP(3);

ALTER TABLE "work_order_repair_parts" ALTER COLUMN "warrantyFromDate" TYPE TIMESTAMP(3),
ALTER COLUMN "warrantyToDate" TYPE TIMESTAMP(3);

ALTER TABLE "daily_machine_logs" ALTER COLUMN "date" TYPE TIMESTAMP(3);

ALTER TABLE "amc_contracts" ALTER COLUMN "startDate" TYPE TIMESTAMP(3),
ALTER COLUMN "endDate" TYPE TIMESTAMP(3);
