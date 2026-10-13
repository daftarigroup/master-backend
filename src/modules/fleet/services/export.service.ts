import ExcelJS from 'exceljs';
import { UserAuthContext } from '../../../utils/currentUser';
import { requireSingleFirm } from '../../../utils/firmScope';
import { MonthLedger, buildMonthLedger } from './ledger.service';

// Diesel issued from the Store, per machine:
//   Date | per machine: Diesel, Start, Stop, Usage | Other (only when the month has old diesel without a machine) | Total
// Blank (not 0) for "no reading" and for open entries, so a missing stop reading can never look like usage.
const PER_MACHINE = ['Diesel', 'Start', 'Stop', 'Usage'] as const;

function table(ledger: MonthLedger) {
  const showOther = ledger.totals.other > 0;
  const header1: string[] = ['Date'];
  const header2: string[] = [''];
  for (const m of ledger.machines) {
    PER_MACHINE.forEach((c, i) => {
      header1.push(i === 0 ? m.name : '');
      header2.push(c);
    });
  }
  if (showOther) { header1.push('Other'); header2.push(''); }
  header1.push('Total');
  header2.push('');

  const blank = (v: number | null | undefined) => (v === null || v === undefined ? '' : v);
  const rows: (string | number)[][] = ledger.rows.map((r) => {
    const out: (string | number)[] = [r.date];
    for (const m of ledger.machines) {
      const c = r.cells[m.id];
      out.push(blank(c?.diesel || null), blank(c?.start), blank(c?.stop), blank(c?.usage));
    }
    if (showOther) out.push(r.other || '');
    out.push(r.total || '');
    return out;
  });

  const totals: (string | number)[] = ['Total'];
  for (const m of ledger.machines) {
    const t = ledger.totals.perMachine[m.id];
    totals.push(t?.diesel ?? '', '', '', t?.usage ?? '');
  }
  if (showOther) totals.push(ledger.totals.other);
  totals.push(ledger.totals.total);
  return { header1, header2, rows, totals };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function ledgerToCsv(ledger: MonthLedger): string {
  const { header1, header2, rows, totals } = table(ledger);
  return [header1, header2, ...rows, totals].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export async function ledgerToXlsx(ledger: MonthLedger): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(ledger.month, { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
  const { header1, header2, rows, totals } = table(ledger);
  ws.addRow(header1);
  ws.addRow(header2);
  rows.forEach((r) => ws.addRow(r));
  ws.addRow(totals);

  // machine names span their four columns
  ledger.machines.forEach((_, i) => {
    const first = 2 + i * 4;
    ws.mergeCells(1, first, 1, first + 3);
  });
  [1, 2].forEach((n) => {
    const row = ws.getRow(n);
    row.font = { bold: true };
    row.alignment = { horizontal: 'center' };
  });
  ws.getRow(ws.rowCount).font = { bold: true };
  ws.getColumn(1).width = 12;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const exportService = {
  async ledger(ctx: UserAuthContext, q: { firmId: unknown; month: string; format: 'csv' | 'xlsx'; includeIdle?: boolean }) {
    const firmId = requireSingleFirm(ctx, q.firmId);
    const ledger = await buildMonthLedger(firmId, q.month, { includeIdle: q.includeIdle });
    const base = `diesel-ledger-${(ledger.firmName ?? String(firmId)).replace(/[^A-Za-z0-9]+/g, '_')}-${q.month}`;
    if (q.format === 'csv') {
      return { filename: `${base}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from('﻿' + ledgerToCsv(ledger), 'utf8') };
    }
    return {
      filename: `${base}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await ledgerToXlsx(ledger),
    };
  },
};
