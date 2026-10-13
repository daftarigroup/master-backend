-- fleet_v5_equipment_types rollback.
-- PostgreSQL cannot drop a single enum value. If a rollback is ever needed, first move any machines off the new
-- values, then rebuild the type:
--
--   UPDATE machines SET "equipmentType" = 'OTHER'
--    WHERE "equipmentType" IN ('LOADER','DOZER','GRADER','CRANE','CONCRETE_PUMP','BATCHING_PLANT','COMPRESSOR','WATER_TANKER');
--   -- then recreate "EquipmentType" without those values and re-point machines."equipmentType" at it.
--
-- Leaving the unused values in the enum is harmless, so the usual "rollback" is to do nothing.
SELECT 1;
