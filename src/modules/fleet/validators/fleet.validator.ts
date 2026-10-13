import { z } from 'zod';
import { bigId, blankToUndefined, bool, optBigId, optDate, optNumber, optText, reqNumber } from '../../../utils/zodIds';

// Every schema here is used with validateParsed, so the coerced / trimmed / defaulted values are what
// the services receive. Shared building blocks live in utils/zodIds.ts.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM');
const limit = z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(1000).optional());
const offset = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional());

/** Read filters keep the raw string: the firm scope turns 'all'/junk into "no specific firm". */
const readFirm = z.string().optional();

const idParams = z.object({ id: z.string().min(1) });
const reason = z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(300) });

export const listFleetMachinesSchema = z.object({
  query: z.object({ firmId: readFirm, ownership: z.enum(['OWNED', 'RENTED']).optional(), q: optText }),
});
export const machineIdSchema = z.object({ params: idParams });
export const machineHistorySchema = z.object({ params: idParams, query: z.object({ from: day.optional(), to: day.optional() }) });

const receiptKind = z.enum(['RECEIPT', 'OPENING', 'ADJUSTMENT']);
export const createReceiptSchema = z.object({
  body: z.object({
    firmId: bigId,
    kind: receiptKind.optional(),
    receivedAt: z.coerce.date(),
    litres: reqNumber,
    issuerName: optText,
    supplierName: optText,
    reference: optText,
    note: optText,
    siteLocationId: optBigId,
    ratePerLitre: z.preprocess(blankToUndefined, z.coerce.number().positive().optional()), // admin only
  }),
});
export const listReceiptsSchema = z.object({
  query: z.object({ firmId: readFirm, from: day.optional(), to: day.optional(), includeVoided: bool, limit, offset }),
});
export const voidSchema = z.object({ params: idParams, body: reason });

export const listDieselLogsSchema = z.object({
  query: z.object({ firmId: readFirm, machineId: optText, q: optText, from: day.optional(), to: day.optional(), includeVoided: bool, limit, offset }),
});

const usageFields = {
  startReading: reqNumber.min(0),
  stopReading: optNumber,
  stoppedAt: optDate,
  meterReset: bool,
  meterResetReason: optText,
  continuityReason: optText,
  operatorId: optBigId,
  remarks: optText,
  wbsActivityId: optText,
};
export const createUsageLogSchema = z.object({
  body: z.object({ firmId: optBigId, machineId: z.string().min(1), startedAt: z.coerce.date(), ...usageFields }),
});
export const closeUsageLogSchema = z.object({
  params: idParams,
  body: z.object({ stopReading: reqNumber.min(0), stoppedAt: optDate }),
});
export const listUsageLogsSchema = z.object({
  query: z.object({
    firmId: readFirm,
    machineId: optText,
    from: day.optional(),
    to: day.optional(),
    status: z.enum(['open', 'complete', 'all']).optional(),
    flagged: bool,
    includeVoided: bool,
    limit,
    offset,
  }),
});

export const dailyEntrySchema = z.object({
  body: z.object({
    firmId: optBigId,
    machineId: optText,
    consumerLabel: optText,
    occurredAt: z.coerce.date(),
    wbsActivityId: optText,
    diesel: z
      .object({ litres: reqNumber.positive('litres must be greater than zero'), issuedAt: optDate, note: optText })
      .nullish(),
    usage: z.object({ ...usageFields, startedAt: optDate }).nullish(),
  }),
});

export const ledgerSchema = z.object({ query: z.object({ firmId: readFirm, month, includeIdle: bool }) });
export const ledgerExportSchema = z.object({
  query: z.object({ firmId: readFirm, month, includeIdle: bool, format: z.enum(['xlsx', 'csv']).default('xlsx') }),
});
export const efficiencySchema = z.object({
  query: z.object({ firmId: readFirm, from: day, to: day, machineId: optText }),
});
export const alertsSchema = z.object({ query: z.object({ firmId: readFirm }) });
