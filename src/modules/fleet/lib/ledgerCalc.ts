// Pure month-ledger calculation for the Diesel Ledger view (the Excel layout):
//   Date | Received | Opening | per machine: Diesel, Start, Stop, Usage | Other | Total | Closing
// The running balance is computed here from the rows, never stored. See plan §A.4 for why
// (back-dated receipts would invalidate any stored snapshot).
// Callers pass only NON-voided rows, every machine that has activity in the month, and the
// balance carried in from before the month (see balanceBefore).

import { daysOfMonth } from './istDate';
import { round2 } from './usageRules';

export interface LedgerMachine {
  id: string;
  name: string;
}
/** Dates are IST 'YYYY-MM-DD'. `litres` is negative only for ADJUSTMENT receipts. */
export interface LedgerReceipt {
  date: string;
  litres: number;
}
/** machineId null = "other diesel" (no machine). */
export interface LedgerDieselLog {
  date: string;
  machineId: string | null;
  litres: number;
}
export interface LedgerUsage {
  date: string;
  machineId: string;
  /** ISO timestamp, the ordering key within a day. */
  startedAt: string;
  startReading: number;
  stopReading: number | null;
  /** Set only for complete entries; null while open. */
  usage: number | null;
}

export interface LedgerCell {
  diesel: number;
  start: number | null;
  stop: number | null;
  /** Sum of complete usages that day, or null when there is no complete entry. */
  usage: number | null;
  entries: number;
  hasOpen: boolean;
}
export interface LedgerRow {
  date: string;
  received: number;
  opening: number;
  /** Sparse: only machines with diesel or usage that day. */
  cells: Record<string, LedgerCell>;
  other: number;
  total: number;
  closing: number;
  negative: boolean;
}
export interface LedgerResult {
  month: string;
  openingBalance: number;
  machines: LedgerMachine[];
  rows: LedgerRow[];
  totals: {
    received: number;
    perMachine: Record<string, { diesel: number; usage: number }>;
    other: number;
    total: number;
    closing: number;
  };
  negativeDates: string[];
}

export interface LedgerInput {
  month: string;
  openingBalance: number;
  machines: LedgerMachine[];
  receipts: LedgerReceipt[];
  dieselLogs: LedgerDieselLog[];
  usageLogs: LedgerUsage[];
}

/** Balance carried in from before `beforeDate` (exclusive): receipts minus issues. */
export function balanceBefore(receipts: LedgerReceipt[], dieselLogs: LedgerDieselLog[], beforeDate: string): number {
  const received = receipts.filter((r) => r.date < beforeDate).reduce((a, r) => a + r.litres, 0);
  const issued = dieselLogs.filter((l) => l.date < beforeDate).reduce((a, l) => a + l.litres, 0);
  return round2(received - issued);
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export function buildLedger(input: LedgerInput): LedgerResult {
  const days = daysOfMonth(input.month);
  const receiptsByDay = groupBy(input.receipts, (r) => r.date);
  const logsByDay = groupBy(input.dieselLogs, (l) => l.date);
  const usageByDay = groupBy(input.usageLogs, (u) => u.date);

  const perMachine: Record<string, { diesel: number; usage: number }> = {};
  for (const m of input.machines) perMachine[m.id] = { diesel: 0, usage: 0 };

  let opening = round2(input.openingBalance);
  let totalReceived = 0;
  let totalOther = 0;
  let totalAll = 0;
  const rows: LedgerRow[] = [];
  const negativeDates: string[] = [];

  for (const date of days) {
    const received = round2((receiptsByDay.get(date) ?? []).reduce((a, r) => a + r.litres, 0));
    const cells: Record<string, LedgerCell> = {};
    const cellFor = (machineId: string): LedgerCell =>
      (cells[machineId] ??= { diesel: 0, start: null, stop: null, usage: null, entries: 0, hasOpen: false });

    let other = 0;
    let total = 0;
    for (const log of logsByDay.get(date) ?? []) {
      total += log.litres;
      if (log.machineId === null) {
        other += log.litres;
      } else {
        cellFor(log.machineId).diesel += log.litres;
      }
    }

    const usagesByMachine = groupBy(usageByDay.get(date) ?? [], (u) => u.machineId);
    for (const [machineId, entries] of usagesByMachine) {
      const ordered = [...entries].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
      const cell = cellFor(machineId);
      cell.entries = ordered.length;
      cell.start = ordered[0].startReading;
      cell.stop = ordered[ordered.length - 1].stopReading;
      cell.hasOpen = ordered.some((e) => e.stopReading === null);
      const complete = ordered.filter((e) => e.usage !== null);
      if (complete.length > 0) cell.usage = round2(complete.reduce((a, e) => a + (e.usage as number), 0));
    }

    for (const [machineId, cell] of Object.entries(cells)) {
      cell.diesel = round2(cell.diesel);
      const agg = (perMachine[machineId] ??= { diesel: 0, usage: 0 });
      agg.diesel = round2(agg.diesel + cell.diesel);
      agg.usage = round2(agg.usage + (cell.usage ?? 0));
    }

    other = round2(other);
    total = round2(total);
    const closing = round2(opening + received - total);
    const negative = closing < 0;
    if (negative) negativeDates.push(date);

    rows.push({ date, received, opening, cells, other, total, closing, negative });

    totalReceived = round2(totalReceived + received);
    totalOther = round2(totalOther + other);
    totalAll = round2(totalAll + total);
    opening = closing;
  }

  return {
    month: input.month,
    openingBalance: round2(input.openingBalance),
    machines: input.machines,
    rows,
    totals: { received: totalReceived, perMachine, other: totalOther, total: totalAll, closing: opening },
    negativeDates,
  };
}
