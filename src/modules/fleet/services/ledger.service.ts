import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { requireSingleFirm } from '../../../utils/firmScope';
import { LedgerResult, buildLedger } from '../lib/ledgerCalc';
import { daysBetween, shiftMonth } from '../lib/istDate';

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
  rows: Array<{ date: string; cells: Record<string, MonthLedgerCell>; other: number; total: number; opening: number; received: number; available: number; closing: number }>;
  totals: { perMachine: Record<string, { diesel: number; usage: number }>; other: number; total: number };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10); // @db.Date columns come back as UTC midnight


const NUMSQL = (c: string) => `(CASE WHEN btrim(COALESCE(${c}::text, '')) ~ '^-?[0-9]+([.][0-9]+)?$' THEN btrim(${c}::text)::numeric ELSE 0 END)`;
const ISTDAY = (c: string) => `((${c} AT TIME ZONE 'Asia/Kolkata')::date)::text`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Store DIESEL stock movement per day for one firm (same rules as StockService: opening + lifted goods receipts + transfers in
 * - transfers out - purchase returns - issues). Returns the balance before `from`, and the per-day received (net of returns /
 * transfers out) and issued figures inside [from, to].
 */
async function storeDieselDaily(firmId: bigint, from: string, to: string) {
  const q = <T,>(sql: string) => prisma.$queryRawUnsafe(sql, firmId) as Promise<T[]>;
  // the Store item DIESEL exactly ("IMPERIO (DIESEL)" etc. are separate items), like StockService
  const like = `lower(regexp_replace(btrim(%s), '[[:space:]]+', ' ', 'g')) = 'diesel'`;
  const firmOf = (a: string, cols: string[]) => `COALESCE(${a}.firm_id, (SELECT f.id FROM firm f WHERE ${cols.map((c) => `lower(btrim(f.firm_name)) = lower(btrim(${a}.${c}))`).join(' OR ')} ORDER BY f.id LIMIT 1))`;
  const [inv, lifted, issued, trf] = await Promise.all([
    q<{ opening: number }>(`SELECT ${NUMSQL('x.opening')} AS opening FROM inventory x WHERE ${firmOf('x', ['firm_name'])} = $1 AND ${like.replace('%s', 'x.item_name')} ORDER BY x.id LIMIT 1`),
    q<{ day: string; qty: number }>(`SELECT CASE WHEN x.receiving_status = 'Transfer' THEN ${ISTDAY('x.timestamp')}
              WHEN btrim(x.material_date::text) ~ '^\\d{4}-\\d{2}-\\d{2}' THEN left(btrim(x.material_date::text), 10) END AS day,
              CASE WHEN x.status = 'Reject' THEN -${NUMSQL('x.received_quantity')} ELSE ${NUMSQL('x.received_quantity')} END AS qty
            FROM store_in x WHERE ${firmOf('x', ['firm_name', 'firm_name_match'])} = $1 AND ${like.replace('%s', 'x.product_name')}`),
    q<{ day: string; qty: number }>(`SELECT COALESCE(${ISTDAY('x.actual1')}, ${ISTDAY('x.timestamp')}) AS day, (${NUMSQL('x.given_qty')} - ${NUMSQL('x.rejected_damage_qty')}) AS qty
            FROM issue x WHERE ${firmOf('x', ['firm_name'])} = $1 AND ${like.replace('%s', 'x.product_name')}`),
    q<{ day: string; qty: number }>(`SELECT ${ISTDAY('x.timestamp')} AS day, CASE WHEN x.to_firm_id = $1 THEN x.quantity ELSE -x.quantity END AS qty
            FROM stock_transfers x WHERE (x.to_firm_id = $1 OR x.from_firm_id = $1) AND ${like.replace('%s', 'x.product_name')}`),
  ]);
  let balance = Number(inv[0]?.opening ?? 0);
  const received: Record<string, number> = {};
  const issuedBy: Record<string, number> = {};
  const add = (rows: Array<{ day: string | null; qty: unknown }>, sign: 1 | -1) => {
    for (const r of rows) {
      if (!r.day) continue;
      const v = Number(r.qty) || 0;
      if (r.day > to) continue;
      if (r.day < from) balance += sign * v;
      else if (sign === 1) received[r.day] = (received[r.day] ?? 0) + v;
      else issuedBy[r.day] = (issuedBy[r.day] ?? 0) + v;
    }
  };
  add(lifted, 1);
  add(trf, 1);
  add(issued, -1);
  return { opening: balance, received, issued: issuedBy };
}

/**
 * The Excel-style month view for ONE firm: per machine, diesel issued from the Store plus the day's start / stop / usage from the work
 * logs, then other (old diesel logged without a machine) and the total. Authorisation is the caller's job; this only computes.
 * The old tank (opening / received / closing balance) is retired: Store inventory is the only diesel stock.
 */
export async function buildMonthLedger(firmId: bigint, month: string, opts: { includeIdle?: boolean; from?: string; to?: string } = {}): Promise<MonthLedger> {
  const range = opts.from && opts.to ? { from: opts.from, to: opts.to } : null;
  const days = range ? daysBetween(range.from, range.to) : undefined;
  const label = range ? `${range.from} to ${range.to}` : month;
  const start = new Date(range ? range.from : `${month}-01`);
  const next = range ? new Date(Date.parse(`${range.to}T00:00:00Z`) + 86_400_000) : new Date(`${shiftMonth(month, 1)}-01`);
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
    month: label,
    days,
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
  const dayList = result.rows.map((r) => r.date);
  const store = await storeDieselDaily(firmId, dayList[0], dayList[dayList.length - 1]);
  let running = store.opening;
  const rows = result.rows.map((r) => {
    const opening = r2(running);
    const received = r2(store.received[r.date] ?? 0);
    const available = r2(opening + received);
    const closing = r2(available - (store.issued[r.date] ?? 0));
    running = closing;
    const cells: Record<string, MonthLedgerCell> = {};
    for (const [machineId, cell] of Object.entries(r.cells)) cells[machineId] = flagged.has(`${r.date}|${machineId}`) ? { ...cell, flagged: true } : cell;
    return { date: r.date, cells, other: r.other, total: r.total, opening, received, available, closing };
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
  async month(ctx: UserAuthContext, q: { firmId: unknown; month?: string; from?: string; to?: string; includeIdle?: boolean }) {
    const firmId = requireSingleFirm(ctx, q.firmId); // 'all' or missing -> 400, another firm -> 403
    return buildMonthLedger(firmId, q.month ?? (q.from ?? '').slice(0, 7), { includeIdle: q.includeIdle, from: q.from, to: q.to });
  },
};
