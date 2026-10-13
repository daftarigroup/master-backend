# fleet_v5b_diesel_receipt_store_link

Found 2026-10-07 while running the backend tests on a rebuilt database: `diesel_receipts.source`, `externalRef`, `issuerName` and the `DieselReceiptSource` enum exist in the local `master_db` and in `schema.prisma`, but no migration file creates them, so a database built from the migration files (the test harness, or AWS RDS) lacked them and 24 fleet tests failed.

- Nothing changes in the local `master_db` (all statements are idempotent no-ops there).
- Apply on any other database after `fleet_v1` .. `fleet_v5`: `psql -v ON_ERROR_STOP=1 -f prisma/pending/fleet_v5b_diesel_receipt_store_link/migration.sql`.
- Replayed by `tests/setup/globalSetup.ts`.
- RDS order: v1, v2, v3, v4, v5, v5b (and later store_item_ref_v1). RDS is not touched by this change.
- Note: Phase 2 of the Store integration plan retires the Store -> `DieselReceipt` sync that uses these columns; they stay until the tank is retired.
