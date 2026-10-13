import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { UserAuthContext } from '../../../utils/currentUser';
import { parseFirmId } from '../../../utils/firmScope';
import { machineAccessWhere } from '../lib/machineAccess';
import { loadMachineInScope } from './common';

/**
 * Phase 7: machine-based billing data. A thin read layer over the views of migration fleet_v8_billing_views (billing_events_v and the
 * four per-type views): no copy of any data, so the cost engine and the billing team always agree. Reachable only behind
 * requireCostAccess; rows are limited to the machines the caller may see (same scope as the cost screens).
 */
export interface BillingQuery {
  from?: string;
  to?: string;
  machineId?: string;
  firmId?: unknown;
  eventType?: 'DIESEL' | 'REPAIR' | 'PARTS' | 'MAINTENANCE';
  counted?: 'true' | 'false';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface BillingRow {
  eventType: string;
  eventId: string;
  machineId: string;
  machineCode: string | null;
  machineName: string | null;
  firmId: string | null;
  firmName: string | null;
  eventDate: string | null;
  docType: string;
  docNo: string | null;
  workOrderCode: string | null;
  vendorName: string | null;
  itemName: string | null;
  groupHead: string | null;
  uom: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  partsCost: number | null;
  labourCost: number | null;
  billNo: string | null;
  billUrl: string | null;
  paidAt: string | null;
  serviceMode: string;
  status: string;
  counted: boolean;
  taxPercent: number | null;
  taxAmount: number | null;
  sourceIssueId: string | null;
  sourceRef: string | null;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : str(v));

function shape(r: Record<string, any>): BillingRow {
  return {
    eventType: r.eventType,
    eventId: r.eventId,
    machineId: r.machineId,
    machineCode: str(r.machineCode),
    machineName: str(r.machineName),
    firmId: str(r.firmId),
    firmName: str(r.firmName),
    eventDate: day(r.eventDate),
    docType: r.docType,
    docNo: str(r.docNo),
    workOrderCode: str(r.workOrderCode),
    vendorName: str(r.vendorName),
    itemName: str(r.itemName),
    groupHead: str(r.groupHead),
    uom: str(r.uom),
    quantity: num(r.quantity),
    rate: num(r.rate),
    amount: num(r.amount),
    partsCost: num(r.partsCost),
    labourCost: num(r.labourCost),
    billNo: str(r.billNo),
    billUrl: str(r.billUrl),
    paidAt: r.paidAt instanceof Date ? r.paidAt.toISOString() : str(r.paidAt),
    serviceMode: r.serviceMode,
    status: r.status,
    counted: !!r.counted,
    taxPercent: num(r.taxPercent),
    taxAmount: num(r.taxAmount),
    sourceIssueId: str(r.sourceIssueId),
    sourceRef: str(r.sourceRef),
  };
}

async function accessibleMachineIds(ctx: UserAuthContext, q: BillingQuery): Promise<string[]> {
  const where: Prisma.MachineWhereInput = { AND: [await machineAccessWhere(ctx, q.firmId), q.machineId ? { id: q.machineId } : {}] };
  return (await prisma.machine.findMany({ where, select: { id: true } })).map((m) => m.id);
}

function conditions(ids: string[], q: BillingQuery): Prisma.Sql {
  const c: Prisma.Sql[] = [Prisma.sql`"machineId" = ANY(${ids}::text[])`];
  const firm = parseFirmId(q.firmId);
  if (firm !== null) c.push(Prisma.sql`"firmId" = ${firm}`);
  if (q.from) c.push(Prisma.sql`"eventDate" >= ${q.from}::date`);
  if (q.to) c.push(Prisma.sql`"eventDate" <= ${q.to}::date`);
  if (q.eventType) c.push(Prisma.sql`"eventType" = ${q.eventType}`);
  if (q.counted) c.push(Prisma.sql`"counted" = ${q.counted === 'true'}`);
  if (q.search) {
    const like = `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    c.push(Prisma.sql`("docNo" ILIKE ${like} OR "machineName" ILIKE ${like} OR "machineCode" ILIKE ${like} OR "itemName" ILIKE ${like} OR "vendorName" ILIKE ${like} OR "workOrderCode" ILIKE ${like})`);
  }
  return Prisma.join(c, ' AND ');
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS: Array<keyof BillingRow> = [
  'eventType', 'eventDate', 'machineCode', 'machineName', 'firmName', 'docType', 'docNo', 'workOrderCode', 'vendorName', 'itemName', 'groupHead', 'uom',
  'quantity', 'rate', 'amount', 'partsCost', 'labourCost', 'billNo', 'billUrl', 'paidAt', 'serviceMode', 'status', 'counted', 'taxPercent', 'taxAmount',
  'sourceIssueId', 'sourceRef', 'eventId', 'machineId', 'firmId',
];

export const billingService = {
  async events(ctx: UserAuthContext, q: BillingQuery) {
    const ids = await accessibleMachineIds(ctx, q);
    if (ids.length === 0) return { rows: [] as BillingRow[], total: 0 };
    const where = conditions(ids, q);
    const take = Math.min(Math.max(q.limit ?? 50, 1), 1000);
    const skip = Math.max(q.offset ?? 0, 0);
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM billing_events_v WHERE ${where} ORDER BY "eventDate" DESC NULLS LAST, "eventType", "eventId" LIMIT ${take} OFFSET ${skip}`,
      prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM billing_events_v WHERE ${where}`,
    ]);
    return { rows: rows.map(shape), total: Number(count[0]?.n ?? 0) };
  },

  async export(ctx: UserAuthContext, q: BillingQuery & { format: 'csv' | 'xlsx' }) {
    const ids = await accessibleMachineIds(ctx, q);
    const where = conditions(ids.length ? ids : [''], q);
    const raw = await prisma.$queryRaw<Array<Record<string, any>>>`SELECT * FROM billing_events_v WHERE ${where} ORDER BY "eventDate" DESC NULLS LAST, "eventType", "eventId" LIMIT 50000`;
    const rows = raw.map(shape);
    const stamp = new Date().toISOString().slice(0, 10);
    if (q.format === 'csv') {
      const body = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
      return { filename: `billing-events-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: Buffer.from('﻿' + body, 'utf8') };
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Billing events');
    ws.addRow(COLUMNS);
    rows.forEach((r) => ws.addRow(COLUMNS.map((c) => r[c] as never)));
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => (c.width = 16));
    return { filename: `billing-events-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: Buffer.from(await wb.xlsx.writeBuffer()) };
  },

  /** Totals per event type for one machine (counted and not counted kept apart). */
  async machineSummary(ctx: UserAuthContext, machineId: string, q: { from?: string; to?: string }) {
    const machine = await loadMachineInScope(prisma as never, ctx, machineId); // 404 when the caller cannot see it
    const c: Prisma.Sql[] = [Prisma.sql`"machineId" = ${machineId}`];
    if (q.from) c.push(Prisma.sql`"eventDate" >= ${q.from}::date`);
    if (q.to) c.push(Prisma.sql`"eventDate" <= ${q.to}::date`);
    const rows = await prisma.$queryRaw<Array<{ eventType: string; counted: boolean; events: bigint; amount: Prisma.Decimal | null }>>`
      SELECT "eventType", "counted", count(*) AS events, sum("amount") AS amount FROM billing_events_v WHERE ${Prisma.join(c, ' AND ')} GROUP BY 1, 2 ORDER BY 1, 2 DESC`;
    return {
      machine: { id: machine.id, name: machine.name, assetCode: machine.assetCode },
      from: q.from ?? null,
      to: q.to ?? null,
      totals: rows.map((r) => ({ eventType: r.eventType, counted: r.counted, events: Number(r.events), amount: num(r.amount) ?? 0 })),
      countedAmount: rows.filter((r) => r.counted).reduce((s, r) => s + (num(r.amount) ?? 0), 0),
    };
  },
};
