/**
 * Purchase Order Creation Service
 * Implements a FIFO Queue and atomic Prisma transactions to prevent duplicate PO numbers
 * when multiple users submit POs concurrently or with pre-rendered numbers.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { SchedulePlannerService } from './schedulePlanner.service';
import { DelayCalculatorService } from './delayCalculator.service';
import { PcReportService } from './pcReport.service';
import {
  normalizeBody,
  syncTableSequence,
  invalidateTableCache,
} from '../controllers/generic.controller';

/**
 * Sequential FIFO Execution Queue
 * Serializes async operations so only one PO creation executes at any given millisecond.
 */
export class AsyncQueue {
  private queue: Promise<any> = Promise.resolve();

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue = this.queue
        .then(async () => {
          try {
            const res = await task();
            resolve(res);
          } catch (err) {
            reject(err);
          }
        })
        .catch(() => {});
    });
  }
}

export const poCreationQueue = new AsyncQueue();

/**
 * Determines financial year in YY-YY format (e.g. 26-27).
 * Uses April-March financial year cycle.
 */
export function getFinancialYear(dateInput?: Date | string): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  const year = validDate.getFullYear();
  const month = validDate.getMonth(); // 0-indexed, April is 3

  let startYear: number, endYear: number;
  if (month >= 3) {
    startYear = year;
    endYear = year + 1;
  } else {
    startYear = year - 1;
    endYear = year;
  }

  return `${startYear.toString().slice(-2)}-${endYear.toString().slice(-2)}`;
}

/**
 * Calculates the next available PO number for a financial year directly from po_master.
 */
export async function getNextPoNumber(
  financialYear?: string,
  tx?: Prisma.TransactionClient
): Promise<string> {
  const db = tx || prisma;
  const fy = financialYear || getFinancialYear();
  const newPrefix = `${fy}/`;
  const oldPrefix = `STORE-PO-${fy}-`;

  const existingRows = await db.poMaster.findMany({
    where: {
      OR: [
        { po_number: { startsWith: newPrefix } },
        { po_number: { startsWith: oldPrefix } },
      ],
    },
    select: { po_number: true },
    distinct: ['po_number'],
  });

  const numbers: number[] = [];
  for (const row of existingRows) {
    if (!row.po_number) continue;
    const poStr = row.po_number.trim();
    let numStr = '';
    if (poStr.startsWith(newPrefix)) {
      numStr = poStr.slice(newPrefix.length).split('-')[0].trim();
    } else if (poStr.startsWith(oldPrefix)) {
      numStr = poStr.slice(oldPrefix.length).split('-')[0].trim();
    }
    const parsed = parseInt(numStr, 10);
    if (!isNaN(parsed) && parsed > 0) {
      numbers.push(parsed);
    }
  }

  const maxNum = numbers.length > 0 ? Math.max(...numbers) : 0;
  const nextNum = maxNum + 1;
  return `${newPrefix}${String(nextNum).padStart(2, '0')}`;
}

/**
 * Calculates the next revision number for an existing PO (e.g. 26-27/51 -> 26-27/51-01).
 */
export async function getNextPoRevision(
  poNumber: string,
  tx?: Prisma.TransactionClient
): Promise<string> {
  const db = tx || prisma;
  const parts = poNumber.split('/');
  if (parts.length < 2) return `${poNumber}-01`;

  const fyPart = parts[0];
  const rest = parts[1];
  const baseNumber = rest.split('-')[0];
  const basePo = `${fyPart}/${baseNumber}`;

  const related = await db.poMaster.findMany({
    where: {
      po_number: { startsWith: basePo },
    },
    select: { po_number: true },
    distinct: ['po_number'],
  });

  const revisionNumbers: number[] = [];
  for (const row of related) {
    if (!row.po_number) continue;
    const num = row.po_number.trim();
    if (num === basePo) {
      revisionNumbers.push(0);
    } else if (num.startsWith(basePo + '-')) {
      const suffix = num.replace(basePo + '-', '');
      const n = parseInt(suffix, 10);
      if (!isNaN(n)) revisionNumbers.push(n);
    }
  }

  const maxRevision = revisionNumbers.length > 0 ? Math.max(...revisionNumbers) : 0;
  const nextRevision = maxRevision + 1;
  return `${basePo}-${String(nextRevision).padStart(2, '0')}`;
}

export interface CreatePOPayload {
  mode?: 'create' | 'revise';
  poNumber?: string;
  poDate?: string | Date;
  financialYear?: string;
  rows: any[];
  indentIds?: number[];
  deliveryDate?: string | Date;
  actualDate?: string | Date;
}

export class POCreationService {
  private pcReportService: PcReportService;

  constructor() {
    this.pcReportService = new PcReportService();
  }

  /**
   * Enqueues the PO creation so concurrent requests are processed sequentially.
   */
  public async createPO(payload: CreatePOPayload) {
    return poCreationQueue.enqueue(async () => {
      return this.executeCreation(payload);
    });
  }

  private async executeCreation(payload: CreatePOPayload) {
    const mode = payload.mode || 'create';
    const clientPoNumber = (payload.poNumber || '').trim();

    return prisma.$transaction(async (tx) => {
      // 1. Determine final PO number atomically from database
      let finalPoNumber: string;

      if (mode === 'revise') {
        finalPoNumber = await getNextPoRevision(clientPoNumber, tx);
      } else {
        // Mode 'create'
        // If client submitted with a specific FY prefix (e.g. '26-27/71'), keep that FY
        const fyMatch = clientPoNumber.match(/^(\d{2}-\d{2})\//);
        const fy = payload.financialYear || (fyMatch ? fyMatch[1] : getFinancialYear(payload.poDate));
        finalPoNumber = await getNextPoNumber(fy, tx);
      }

      const wasReassigned = Boolean(clientPoNumber && finalPoNumber !== clientPoNumber);

      // 2. Validate rows
      if (!payload.rows || !Array.isArray(payload.rows) || payload.rows.length === 0) {
        throw new ApiError(400, 'Cannot create PO without item rows');
      }

      // 3. Insert rows into po_master with assigned finalPoNumber
      const createdRows: any[] = [];
      for (const rawRow of payload.rows) {
        const itemData = {
          ...rawRow,
          po_number: finalPoNumber,
        };
        delete itemData.id;

        const data = normalizeBody('po_master', itemData);
        let created: any;
        try {
          created = await tx.poMaster.create({ data: data as any });
        } catch (err: any) {
          const isIdUniqueError =
            err?.code === 'P2002' ||
            String(err?.message || '').includes('id') ||
            String(err?.message || '').includes('Unique constraint');

          if (isIdUniqueError) {
            console.warn(`⚠️ ID constraint failure on 'po_master'. Syncing sequence and retrying...`);
            await syncTableSequence('po_master', tx);
            created = await tx.poMaster.create({ data: data as any });
          } else {
            throw err;
          }
        }
        createdRows.push(created);
      }

      // 4. Update linked indents inside the same transaction
      if (payload.indentIds && Array.isArray(payload.indentIds) && payload.indentIds.length > 0) {
        const actual4Date = payload.actualDate
          ? new Date(payload.actualDate)
          : payload.poDate
            ? new Date(payload.poDate)
            : new Date();
        const validActual4 = isNaN(actual4Date.getTime()) ? new Date() : actual4Date;
        const deliveryDateObj = payload.deliveryDate ? new Date(payload.deliveryDate) : null;
        const validDeliveryDate =
          deliveryDateObj && !isNaN(deliveryDateObj.getTime()) ? deliveryDateObj : null;
        const planned5Date = SchedulePlannerService.skipSunday(validActual4);

        for (const indentId of payload.indentIds) {
          const numericId = Number(indentId);
          if (isNaN(numericId) || numericId <= 0) continue;

          const indent = await tx.indent.findUnique({ where: { id: numericId } });
          const timeDelay4 =
            indent?.planned4 && validActual4
              ? DelayCalculatorService.calculateDelay(validActual4, indent.planned4)
              : undefined;

          await tx.indent.update({
            where: { id: numericId },
            data: {
              actual4: validActual4,
              po_number: finalPoNumber,
              delivery_date: validDeliveryDate,
              planned5: planned5Date,
              ...(timeDelay4 !== undefined ? { time_delay4: timeDelay4 } : {}),
            },
          });
        }
      }

      // 5. Invalidate caches and recalculate KPIs
      invalidateTableCache('po_master');
      invalidateTableCache('indent');
      await this.pcReportService.recalculateStageKpis('PO WebApp', tx);

      return {
        success: true,
        poNumber: finalPoNumber,
        originalPoNumber: clientPoNumber,
        wasReassigned,
        count: createdRows.length,
      };
    });
  }
}
