-- fleet_v5_equipment_types: construction-site equipment types for machines.equipmentType
-- Additive only. Each ADD VALUE is idempotent, so the file is re-runnable. Rollback notes: down.sql
-- Run each statement outside an explicit transaction block (a new enum value cannot be used in the same transaction).

ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'LOADER';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'DOZER';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'GRADER';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'CRANE';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'CONCRETE_PUMP';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'BATCHING_PLANT';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'COMPRESSOR';
ALTER TYPE "EquipmentType" ADD VALUE IF NOT EXISTS 'WATER_TANKER';
