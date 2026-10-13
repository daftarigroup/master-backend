// Prisma reports a foreign-key problem differently depending on the driver. With the pg driver adapter used here,
// deleting a row that is still referenced under ON DELETE RESTRICT arrives as P2039 (Postgres 23001), not the
// P2003 the Prisma docs show, so check the codes and the underlying Postgres code.
const FK_PRISMA_CODES = new Set(['P2003', 'P2014', 'P2039']);
const FK_PG_CODES = new Set(['23001', '23503']); // restrict_violation, foreign_key_violation

export function isForeignKeyViolation(e: unknown): boolean {
  const err = e as { code?: string; meta?: { driverAdapterError?: { cause?: { originalCode?: string } } } } | null;
  if (!err) return false;
  if (err.code && FK_PRISMA_CODES.has(err.code)) return true;
  const pg = err.meta?.driverAdapterError?.cause?.originalCode;
  return Boolean(pg && FK_PG_CODES.has(pg));
}
