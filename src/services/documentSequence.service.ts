import { Prisma } from '@prisma/client';
import { prisma } from '../database/prisma';

// Atomic per-firm/prefix/year counter backing every human-readable business code
// (asset codes, work order numbers, indent numbers, ...). Replaces the frontend
// mocks' `array.length + 1` numbering, which produces duplicate codes after any
// delete — see ASSET_MAINTENANCE_REPAIR_SCHEMA_ARCHITECTURE.md §5 rule 6.
//
// `year` is part of the uniqueness key for codes that reset yearly (e.g. REP-2026-001).
// Codes that never reset (e.g. Asset's SN-0001) should always pass `year: 0` as a
// sentinel "no year" bucket.
export const documentSequenceService = {
  async next(
    { firmId, prefix, year = 0, pad = 3 }: { firmId?: bigint | null; prefix: string; year?: number; pad?: number },
    client: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<string> {
    // Prisma's compound-unique shorthand can't take `null` for a nullable column, so
    // firm-less sequences (global codes not scoped to a firm) use 0n as a sentinel —
    // safe since Firm.id is an autoincrement starting at 1, never 0.
    const firmKey = firmId ?? 0n;

    // upsert is a single atomic INSERT ... ON CONFLICT DO UPDATE — safe under
    // concurrent callers, unlike a separate findFirst + create/update pair.
    const seq = await client.documentSequence.upsert({
      where: { firmId_prefix_year: { firmId: firmKey, prefix, year } },
      create: { firmId: firmKey, prefix, year, lastValue: 1 },
      update: { lastValue: { increment: 1 } },
    });

    const number = String(seq.lastValue).padStart(pad, '0');
    return year > 0 ? `${prefix}-${year}-${number}` : `${prefix}-${number}`;
  },
};
