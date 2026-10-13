import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { requireSingleFirm } from '../../../utils/firmScope';
import { LedgerResult, buildLedger } from '../lib/ledgerCalc';
import { shiftMonth } from '../lib/istDate';

export interface LedgerMachineMeta {
  id: string;
  name: string;
  readingUnit: string;
  ownershipType: string;
  registrationNo: string | null;
}

/** A day cell of the month grid; `flagged` = a diesel issue of that day has a doubtful meter reading. */
export type MonthLedgerCell = LedgerResult['rows'][number]['cells'][string] & { flagged?: boolean };

/** The per-machine month grid of diesel issued from the Store (no tank balance any more). */
export interface MonthLedger {
  month: string;
  firmId: string;
  firmName: string | null;
  machines: LedgerMachineMeta[];
  rows: Array<{ date: string; cells: Record<string, MonthLedgerCell>; other: number; total: number }>;
  totals: { perMachine: Record<string, { diesel: number; usage: number }>; other: number; total: number };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10); // @db.Date columns come back as UTC midnight

/**
 * The Excel-style month view for ONE firm: per machine, diesel issued from the Store plus the day's start / stop / usage from the work
 * logs, then other (old diesel logged without a machine) and the total. Authorisation is the caller's job; this only computes.
 * The old tank (opening / received / closing balance) is retired: Store inventory is the only diesel stock.
 */
export async function buildMonthLedger(firmId: bigint, month: string, opts: { includeIdle?: boolean } = {}): Promise<MonthLedger> {
  const start = new Date(`${month}-01`);
  const next = new Date(`${shiftMonth(month, 1)}-01`);
  const live = { firmId, voidedAt: null } as const;

  const [firm, logs, usages] = await Promise.all([
    prisma.firm.findUnique({ where: { id: firmId }, select: { firm_name: true } }),
    prisma.dieselLog.findMany({ where: { ...live, issueDate: { gte: start, lt: next } }, select: { issueDate: true, machineId: true, litres: true, flags: true } }),
    prisma.machineUsageLog.findMany({
      where: { ...live, status: { not: 'REJECTED' }, logDate: { gte: start, lt: next } },
      select: { logDate: true, machineId: true, startedAt: true, startReading: true, stopReading: true, usage: true },
    }),
  ]);

  const activeIds = new Set<string>();
  logs.forEach((l) => l.machineId && activeIds.add(l.machineId));
  usages.forEach((u) => activeIds.add(u.machineId));
  const machines = await prisma.machine.findMany({
    where: opts.includeIdle
      ? {
          OR: [
            { id: { in: [...activeIds] } },
            {
              firmId,
              isActive: true,
              assignments: { none: { endedAt: null, firmId: { not: firmId } } },
            },
            {
              assignments: { some: { endedAt: null, firmId } },
              isActive: true,
            },
          ],
        }
      : { id: { in: [...activeIds] } },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, readingUnit: true, ownershipType: true, registrationNo: true },
  });

  const result = buildLedger({
    month,
    openingBalance: 0,
    machines: machines.map((m) => ({ id: m.id, name: m.name })),
    receipts: [],
    dieselLogs: logs.map((l) => ({ date: isoDay(l.issueDate), machineId: l.machineId, litres: Number(l.litres) })),
    usageLogs: usages.map((u) => ({
      date: isoDay(u.logDate),
      machineId: u.machineId,
      startedAt: u.startedAt.toISOString(),
      startReading: Number(u.startReading),
      stopReading: u.stopReading === null ? null : Number(u.stopReading),
      usage: u.usage === null ? null : Number(u.usage),
    })),
  });

  // days with a doubtful meter reading on a diesel issue (day, machine)
  const flagged = new Set(logs.filter((l) => l.machineId && l.flags.length > 0).map((l) => `${isoDay(l.issueDate)}|${l.machineId}`));
  const rows = result.rows.map((r) => {
    const cells: Record<string, MonthLedgerCell> = {};
    for (const [machineId, cell] of Object.entries(r.cells)) cells[machineId] = flagged.has(`${r.date}|${machineId}`) ? { ...cell, flagged: true } : cell;
    return { date: r.date, cells, other: r.other, total: r.total };
  });

  return {
    month: result.month,
    rows,
    totals: { perMachine: result.totals.perMachine, other: result.totals.other, total: result.totals.total },
    firmId: String(firmId),
    firmName: firm?.firm_name ?? null,
    machines: machines.map((m) => ({ id: m.id, name: m.name, readingUnit: m.readingUnit, ownershipType: m.ownershipType, registrationNo: m.registrationNo })),
  };
}

export const ledgerService = {
  async month(ctx: UserAuthContext, q: { firmId: unknown; month: string; includeIdle?: boolean }) {
    const firmId = requireSingleFirm(ctx, q.firmId); // 'all' or missing -> 400, another firm -> 403
    return buildMonthLedger(firmId, q.month, { includeIdle: q.includeIdle });
  },
};
