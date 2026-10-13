# fleet_v5_equipment_types

Adds construction-site equipment types to the `EquipmentType` enum: LOADER, DOZER, GRADER, CRANE, CONCRETE_PUMP,
BATCHING_PLANT, COMPRESSOR, WATER_TANKER.

- Additive, idempotent, no data change.
- **Applied to local `master_db` only.** Not applied to RDS (same rule as fleet_v1 to v4: apply the pending
  migrations in order before pointing `.env` at RDS, because the regenerated Prisma client expects these values).
- Apply: `psql -v ON_ERROR_STOP=1 -f prisma/pending/fleet_v5_equipment_types/migration.sql` against the target database
  (`prisma db execute --file` did not accept the file in this environment).
- Code that lists the enum and must stay in step: `schema.prisma`, `maintenance/validators/machine.validator.ts`,
  `fleet/validators/cost.validator.ts`, `fleet/lib/equipment.ts`, and the frontend `EquipmentType` unions and labels.
