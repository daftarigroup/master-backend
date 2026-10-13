import { z } from 'zod';
import { bigId, blankToUndefined, bool, optBigId, optNumber, optText, reqNumber } from '../../../utils/zodIds';
import { EQUIPMENT_TYPE_VALUES } from '../lib/equipment';

// Validators for the equipment list and the cost endpoints (used with validateParsed, so values arrive coerced and trimmed).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const limit = z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(1000).optional());
const offset = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional());
const readFirm = z.string().optional(); // raw: the firm scope turns 'all' / junk into "no specific firm"
const idParams = z.object({ id: z.string().min(1) });
const reason = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(300) });

export const EQUIPMENT_TYPES = EQUIPMENT_TYPE_VALUES;
const equipmentType = z.enum(EQUIPMENT_TYPES);
const ownership = z.enum(['OWNED', 'RENTED']);

export const equipmentListSchema = z.object({
  query: z.object({
    firmId: readFirm,
    q: optText,
    category: z.preprocess(blankToUndefined, equipmentType.optional()),
    ownership: z.preprocess(blankToUndefined, ownership.optional()),
    status: z.preprocess(blankToUndefined, z.enum(['IN_USE', 'UNDER_MAINT', 'IDLE', 'AVAILABLE', 'IN_TRANSIT']).optional()),
    siteId: optBigId,
    vendor: optText,
    month: z.preprocess(blankToUndefined, month.optional()),
    includeInactive: bool,
    sort: z.preprocess(blankToUndefined, z.enum(['code', 'name', 'utilization', 'status', 'recent', 'site']).optional()),
    dir: z.preprocess(blankToUndefined, z.enum(['asc', 'desc']).optional()),
    limit,
    offset,
  }),
});
export const equipmentSummarySchema = z.object({ params: idParams, query: z.object({ month: z.preprocess(blankToUndefined, month.optional()) }) });

export const machineCostSchema = z.object({
  params: idParams,
  query: z.object({
    month: z.preprocess(blankToUndefined, month.optional()),
    category: z.preprocess(blankToUndefined, z.enum(['FUEL', 'MAINTENANCE', 'RENTAL', 'OTHER']).optional()),
    wbsId: optText,
  }),
});
export const trendSchema = z.object({
  params: idParams,
  query: z.object({ month: z.preprocess(blankToUndefined, month.optional()), months: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(24).optional()) }),
});
export const costLogsSchema = z.object({
  params: z.object({ id: z.string().min(1), kind: z.enum(['usage', 'diesel', 'maintenance', 'entries', 'rates']) }),
  query: z.object({ month: z.preprocess(blankToUndefined, month.optional()), limit, offset }),
});
export const fleetCostSchema = z.object({
  query: z.object({
    firmId: readFirm,
    month: z.preprocess(blankToUndefined, month.optional()),
    ownership: z.preprocess(blankToUndefined, ownership.optional()),
    category: z.preprocess(blankToUndefined, equipmentType.optional()),
    siteId: optBigId,
    sort: z.preprocess(blankToUndefined, z.enum(['spend', 'hours', 'costPerUnit', 'utilization', 'name']).optional()),
    dir: z.preprocess(blankToUndefined, z.enum(['asc', 'desc']).optional()),
    limit,
    offset,
  }),
});
export const costReportSchema = z.object({
  query: z
    .object({
      scope: z.enum(['machine', 'fleet']),
      machineId: optText,
      firmId: readFirm,
      month,
      format: z.enum(['xlsx', 'csv']).default('xlsx'),
    })
    .refine((q) => q.scope !== 'machine' || q.machineId, { message: 'machineId is required for a machine report', path: ['machineId'] }),
});

export const createRateSchema = z.object({
  params: idParams,
  body: z.object({
    rateType: z.enum(['INTERNAL_HOURLY', 'RENTAL']),
    basis: z.enum(['HOUR', 'DAY', 'MONTH', 'KM']),
    amount: reqNumber.min(0),
    minBillableQty: optNumber,
    extraRate: optNumber,
    deductBreakdownDays: bool,
    effectiveFrom: day,
    note: optText,
  }),
});
export const endRateSchema = z.object({ params: z.object({ id: z.string().min(1), rateId: z.string().min(1) }), body: z.object({ endDate: day }) });

const entryCategory = z.enum(['OPERATOR', 'TRANSPORT', 'INSURANCE', 'CONSUMABLES', 'RENTAL_INVOICE', 'OTHER']);
export const createCostEntrySchema = z.object({
  body: z.object({
    machineId: z.string().min(1),
    costDate: day,
    category: entryCategory,
    amount: reqNumber.positive('amount must be greater than zero'),
    wbsActivityId: optText,
    description: optText,
    attachmentUrl: optText,
  }),
});
export const updateCostEntrySchema = z.object({
  params: idParams,
  body: z.object({
    costDate: z.preprocess(blankToUndefined, day.optional()),
    category: z.preprocess(blankToUndefined, entryCategory.optional()),
    amount: z.preprocess(blankToUndefined, z.coerce.number().finite().positive().optional()),
    wbsActivityId: z.union([z.string(), z.null()]).optional(),
    description: z.union([z.string(), z.null()]).optional(),
    attachmentUrl: z.union([z.string(), z.null()]).optional(),
  }),
});
export const voidCostEntrySchema = z.object({ params: idParams, body: reason });

export const listWbsSchema = z.object({ query: z.object({ firmId: readFirm, includeClosed: bool, q: optText }) });
export const createWbsSchema = z.object({
  body: z.object({
    firmId: bigId,
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(200),
    parentId: optText,
    siteLocationId: optBigId,
  }),
});
export const updateWbsSchema = z.object({
  params: idParams,
  body: z.object({ name: z.string().trim().min(1).max(200).optional(), status: z.enum(['ACTIVE', 'CLOSED']).optional() }),
});

export const getSettingsSchema = z.object({ query: z.object({ firmId: readFirm }) });
export const putSettingsSchema = z.object({
  body: z.object({
    firmId: z.union([z.string(), z.number()]),
    standardHoursPerDay: z.preprocess(blankToUndefined, z.coerce.number().positive().max(24).optional()),
    idleAfterDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(60).optional()),
    defaultDieselRate: z.union([z.coerce.number().positive(), z.null()]).optional(),
    workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    dayShiftStartMin: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(1439).optional()),
    dayShiftEndMin: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(1440).optional()),
    blockWorkWhenServiceOverdue: z.boolean().optional(),
    countPendingLogsInTotals: z.boolean().optional(),
    serviceLeadPercent: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(100).optional()),
    serviceLeadDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(365).optional()),
    documentExpiryWindowDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(365).optional()),
  }),
});

export const setReceiptRateSchema = z.object({ params: idParams, body: z.object({ ratePerLitre: reqNumber.positive('rate must be greater than zero') }) });

// Phase 7: billing data (read-only views over machine events)
const realDay = day.refine((v) => { const d = new Date(v + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }, 'not a real date');
const billingFilters = {
  firmId: readFirm,
  machineId: optText,
  from: z.preprocess(blankToUndefined, realDay.optional()),
  to: z.preprocess(blankToUndefined, realDay.optional()),
  eventType: z.preprocess(blankToUndefined, z.enum(['DIESEL', 'REPAIR', 'PARTS', 'MAINTENANCE']).optional()),
  counted: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
  search: optText,
};
export const billingEventsSchema = z.object({ query: z.object({ ...billingFilters, limit, offset }) });
export const billingExportSchema = z.object({ query: z.object({ ...billingFilters, format: z.preprocess(blankToUndefined, z.enum(['csv', 'xlsx']).default('csv')) }) });
export const billingSummarySchema = z.object({
  params: idParams,
  query: z.object({ from: z.preprocess(blankToUndefined, realDay.optional()), to: z.preprocess(blankToUndefined, realDay.optional()) }),
});
