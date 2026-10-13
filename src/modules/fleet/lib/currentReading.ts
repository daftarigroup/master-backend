// THE current reading of a machine. One definition for Equipment cards, Cost Tracking headers, Daily Entry / Work Log prefill,
// service due and the chain check:
//
//   the stop reading of the latest COMPLETE, non-voided, non-rejected usage log (latest by start time),
//   else the machine's opening reading when one was set (0 means "unknown"), else null.
//
// Machines with no meter (readingUnit NONE) have no reading. It used to be re-implemented in four places.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

export interface ReadingMachine {
  id: string;
  openingReading: Prisma.Decimal | number | string;
  readingUnit?: 'KM' | 'HOURS' | 'NONE';
}

const openingOrNull = (m: ReadingMachine): number | null => {
  const opening = Number(m.openingReading);
  return opening > 0 ? opening : null;
};

/** The reading a new entry should start from. `before` = only entries that started earlier (used for the chain check). */
export async function currentReadingFor(db: Db, machine: ReadingMachine, before?: Date): Promise<number | null> {
  if (machine.readingUnit === 'NONE') return null;
  const prev = await db.machineUsageLog.findFirst({
    where: { machineId: machine.id, voidedAt: null, status: { not: 'REJECTED' }, stopReading: { not: null }, ...(before ? { startedAt: { lt: before } } : {}) },
    orderBy: { startedAt: 'desc' },
    select: { stopReading: true },
  });
  if (prev?.stopReading != null) return Number(prev.stopReading);
  return openingOrNull(machine);
}

/** Batched version for lists: one query for many machines. */
export async function currentReadings(db: Db, machines: ReadingMachine[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (machines.length === 0) return out;
  const ids = machines.map((m) => m.id);
  const rows = await db.$queryRaw<Array<{ machineId: string; stopReading: string }>>`
    SELECT DISTINCT ON ("machineId") "machineId", "stopReading"::text AS "stopReading"
    FROM machine_usage_logs
    WHERE "machineId" = ANY(${ids}) AND "voidedAt" IS NULL AND "status" <> 'REJECTED' AND "stopReading" IS NOT NULL
    ORDER BY "machineId", "startedAt" DESC`;
  const latest = new Map(rows.map((r) => [r.machineId, Number(r.stopReading)]));
  for (const m of machines) out.set(m.id, m.readingUnit === 'NONE' ? null : (latest.get(m.id) ?? openingOrNull(m)));
  return out;
}
