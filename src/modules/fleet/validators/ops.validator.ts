import { z } from 'zod';
import { bigId, blankToUndefined, bool, optBigId, optDate, optNumber, optText } from '../../../utils/zodIds';

// Work logs, work types, assignments, operators, availability and transfers (used with validateParsed).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const optDay = z.preprocess(blankToUndefined, day.optional());
const nullableDay = z.union([day, z.null()]).optional();
const limit = z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(500).optional());
const offset = z.preprocess(blankToUndefined, z.coerce.number().int().min(0).optional());
const readFirm = z.string().optional();
const idParams = z.object({ id: z.string().min(1) });
const shift = z.enum(['DAY', 'NIGHT', 'GENERAL']);
const reason = (label: string) => z.string().trim().min(3, `give a ${label} (at least 3 characters)`).max(300);

// ---- work logs
const workLogFields = {
  startedAt: z.coerce.date(),
  stoppedAt: z.preprocess(blankToUndefined, z.coerce.date().nullable().optional()),
  startReading: optNumber,
  stopReading: optNumber,
  operatorId: optBigId,
  workTypeId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  locationText: optText,
  // shift, output, output unit and trips are no longer entered. Fuel is accepted only so an old client gets a clear error
  // (diesel is issued from Store Issue now); the service rejects any litres above zero.
  fuelLitres: z.preprocess(blankToUndefined, z.coerce.number().min(0).optional()),
  remarks: optText,
  wbsActivityId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  meterReset: bool,
  meterResetReason: optText,
  continuityReason: optText,
};

export const createWorkLogSchema = z.object({
  body: z.object({
    clientRequestId: z.preprocess(blankToUndefined, z.string().trim().min(8).max(100).optional()),
    firmId: optBigId,
    machineId: z.string().min(1, 'machineId is required'),
    ...workLogFields,
  }),
});

export const updateWorkLogSchema = z.object({
  params: idParams,
  body: z.object({ ...workLogFields, startedAt: z.preprocess(blankToUndefined, z.coerce.date().optional()) }),
});

export const listWorkLogsSchema = z.object({
  query: z.object({
    firmId: readFirm,
    machineId: optText,
    date: optDay,
    from: optDay,
    to: optDay,
    status: z.preprocess(blankToUndefined, z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional()),
    operatorId: optBigId,
    mine: bool,
    limit,
    offset,
  }),
});

export const workLogIdSchema = z.object({ params: idParams });
export const prefillSchema = z.object({ params: idParams, query: z.object({ at: optDate }) });
export const rejectWorkLogSchema = z.object({ params: idParams, body: z.object({ reason: reason('reason') }) });
export const reopenWorkLogSchema = z.object({ params: idParams, body: z.object({ note: reason('reason') }) });
export const bulkApproveSchema = z.object({ body: z.object({ ids: z.array(z.string().min(1)).min(1).max(200) }) });

// ---- work types
export const listWorkTypesSchema = z.object({ query: z.object({ firmId: readFirm, includeInactive: bool }) });
export const createWorkTypeSchema = z.object({ body: z.object({ firmId: bigId, name: z.string().trim().min(1).max(60) }) });
export const updateWorkTypeSchema = z.object({
  params: idParams,
  body: z.object({ name: z.string().trim().min(1).max(60).optional(), isActive: z.boolean().optional(), sortOrder: z.coerce.number().int().min(0).optional() }),
});

// ---- assignments, operators, availability
const derivedStatus = z.enum(['IN_USE', 'IDLE', 'UNDER_MAINT', 'AVAILABLE', 'IN_TRANSIT']);
export const listAssignmentsSchema = z.object({
  query: z.object({
    firmId: readFirm,
    status: z.preprocess(blankToUndefined, derivedStatus.optional()),
    q: optText,
    siteId: optBigId,
    overdue: bool,
    assignedOnly: bool,
    limit,
    offset,
  }),
});
export const assignMachineSchema = z.object({
  body: z.object({
    machineId: z.string().min(1),
    firmId: bigId,
    siteLocationId: optBigId,
    expectedReturnAt: nullableDay,
    responsibleUserId: optBigId,
    note: optText,
  }),
});
export const updateAssignmentSchema = z.object({
  params: idParams,
  body: z.object({ expectedReturnAt: nullableDay, responsibleUserId: z.union([bigId, z.null()]).optional(), siteLocationId: z.union([bigId, z.null()]).optional(), note: z.union([z.string().trim().max(500), z.null()]).optional() }),
});
export const releaseAssignmentSchema = z.object({ params: idParams, body: z.object({ reason: optText, returnedToVendor: z.boolean().optional() }) });

export const listOperatorsSchema = z.object({ query: z.object({ machineId: optText, userId: optBigId, expiringInDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(365).optional()) }) });
export const assignOperatorSchema = z.object({
  body: z.object({
    machineId: z.string().min(1),
    userId: optBigId,
    userIds: z.array(bigId).optional(),
    shift: z.preprocess(blankToUndefined, shift.optional()),
    validFrom: optDay,
    validTill: nullableDay,
  }).refine((b) => b.userId != null || (b.userIds != null && b.userIds.length > 0), {
    message: 'Either userId or userIds must be provided',
    path: ['userIds'],
  }),
});
export const endOperatorSchema = z.object({ params: idParams });

export const availabilitySchema = z.object({
  query: z.object({ firmId: readFirm, from: optDay, days: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(31).optional()), machineId: optText, status: z.preprocess(blankToUndefined, derivedStatus.optional()) }),
});

// ---- transfers
export const listTransfersSchema = z.object({
  query: z.object({
    firmId: readFirm,
    status: z.preprocess(blankToUndefined, z.enum(['OPEN', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED']).optional()),
    machineId: optText,
    limit,
    offset,
  }),
});
export const requestTransferSchema = z.object({
  body: z.object({ machineId: z.string().min(1), toFirmId: bigId, toSiteLocationId: optBigId, eta: nullableDay, note: optText }),
});
export const transferIdSchema = z.object({ params: idParams });
export const dispatchTransferSchema = z.object({ params: idParams, body: z.object({ transporter: optText, vehicleNo: optText, lrRef: optText, eta: nullableDay }) });
export const receiveTransferSchema = z.object({ params: idParams, body: z.object({ responsibleUserId: optBigId, expectedReturnAt: nullableDay, note: optText }) });
export const cancelTransferSchema = z.object({ params: idParams, body: z.object({ reason: reason('reason') }) });
