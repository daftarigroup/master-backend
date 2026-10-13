-- Rollback for fleet_v8_billing_views. Views only: nothing is lost.
DROP VIEW IF EXISTS billing_events_v;
DROP VIEW IF EXISTS billing_parts_v;
DROP VIEW IF EXISTS billing_maintenance_v;
DROP VIEW IF EXISTS billing_repair_v;
DROP VIEW IF EXISTS billing_diesel_v;
