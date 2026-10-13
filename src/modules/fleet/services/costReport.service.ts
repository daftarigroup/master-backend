// Cost report export (xlsx / csv). Built from the same service output as the screens, so a report can never disagree with them.
// Voided records never reach it (the engine and loaders exclude them) and it is only reachable behind requireCostAccess.
// PDF is produced in the browser from the on-screen report (print to PDF): there is no PDF library on the server.
import ExcelJS from 'exceljs';
import { UserAuthContext } from '../../../utils/currentUser';
import { costSummaryService } from './costSummary.service';

type Cell = string | number | null;

const csvCell = (v: Cell) => {
  const s = v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

interface Sheet {
  name: string;
  rows: Cell[][];
}

async function machineSheets(ctx: UserAuthContext, machineId: string, month: string): Promise<{ title: string; sheets: Sheet[] }> {
  const d = await costSummaryService.machine(ctx, machineId, { month });
  const t = d.tiles;
  const summary: Cell[][] = [
    [`${d.machine.name} (${d.machine.assetCode})`, month],
    [],
    ['Category', 'Amount', 'Share %', 'Status'],
    ['Fuel', t.fuel.amount, t.fuel.share, t.fuel.status],
    ['Maintenance', t.maintenance.amount, t.maintenance.share, t.maintenance.status],
    ['Rental', t.rental.amount, t.rental.share, t.rental.status],
    ['Other', t.other.amount, t.other.share, t.other.status],
    ['Total Spend', t.total, 100, ''],
    [],
    [`Hours/Km (${d.usage.unit ?? '-'})`, d.usage.quantity],
    ['Cost per unit', d.metrics.costPerUnit],
    ['Utilization %', d.utilization.percent],
    ['Internal rate (reference, not in Total Spend)', d.metrics.referenceRate?.amount ?? null],
    ['Charge-out value (reference)', d.metrics.chargeOutValue],
  ];
  const wbs: Cell[][] = [
    ['Code', 'Activity', 'Hours', 'Fuel', 'Maintenance', 'Rental', 'Other', 'Total', 'Cost/Unit', '% of spend'],
    ...d.wbs.rows.map((r) => [r.code, r.name, r.hours, r.fuel, r.maintenance, r.rental, r.other, r.total, r.costPerUnit, r.percentOfSpend]),
    ['', 'Total', d.wbs.totals.hours, d.wbs.totals.fuel, d.wbs.totals.maintenance, d.wbs.totals.rental, d.wbs.totals.other, d.wbs.totals.total, d.wbs.totals.costPerUnit, d.wbs.totals.percentOfSpend],
  ];
  return { title: `cost-${d.machine.assetCode}-${month}`, sheets: [{ name: 'Summary', rows: summary }, { name: 'Cost by WBS', rows: wbs }] };
}

async function fleetSheets(ctx: UserAuthContext, q: { firmId?: unknown; month: string }): Promise<{ title: string; sheets: Sheet[] }> {
  const d = await costSummaryService.fleet(ctx, { firmId: q.firmId, month: q.month, limit: 1000 });
  const k = d.kpis;
  return {
    title: `fleet-cost-${q.month}`,
    sheets: [
      {
        name: 'Fleet',
        rows: [
          ['Machine', 'Code', 'Ownership', 'Category', 'Site', 'Spend', 'Hours/Km', 'Unit', 'Cost/Unit', 'Utilization %'],
          ...d.rows.map((r) => [r.name, r.assetCode, r.ownershipType, r.category, r.site, r.spend, r.hours, r.unit, r.costPerUnit, r.utilization]),
          ['Total', '', '', '', '', k.totalSpend, k.hours, '', k.costPerHour, k.utilization],
        ],
      },
      {
        name: 'By category',
        rows: [['Category', 'Amount', 'Share %'], ...(['fuel', 'maintenance', 'rental', 'other'] as const).map((c) => [c, k.categories[c], k.shares ? k.shares[c] : null]), ['Total', k.totalSpend, 100]],
      },
    ],
  };
}

export const costReportService = {
  async export(ctx: UserAuthContext, q: { scope: 'machine' | 'fleet'; machineId?: string; firmId?: unknown; month: string; format: 'xlsx' | 'csv' }) {
    const { title, sheets } = q.scope === 'machine' ? await machineSheets(ctx, q.machineId!, q.month) : await fleetSheets(ctx, q);
    const safe = title.replace(/[^A-Za-z0-9._-]+/g, '_');

    if (q.format === 'csv') {
      const body = sheets.map((s) => [s.name, ...s.rows.map((r) => r.map(csvCell).join(','))].join('\r\n')).join('\r\n\r\n') + '\r\n';
      return { filename: `${safe}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from('﻿' + body, 'utf8') };
    }
    const wb = new ExcelJS.Workbook();
    for (const s of sheets) {
      const ws = wb.addWorksheet(s.name);
      s.rows.forEach((r) => ws.addRow(r));
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach((c) => (c.width = 16));
    }
    return { filename: `${safe}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(await wb.xlsx.writeBuffer()) };
  },
};
