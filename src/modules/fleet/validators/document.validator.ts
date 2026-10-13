import { z } from 'zod';
import { bigId, blankToUndefined, bool, optBigId, optText } from '../../../utils/zodIds';

// Machine / operator documents (used with validateParsed).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const optDay = z.preprocess(blankToUndefined, day.optional());
const nullableDay = z.union([day, z.null(), z.literal('').transform(() => null)]).optional();
const idParams = z.object({ id: z.string().min(1) });
const optId = z.preprocess(blankToUndefined, z.string().min(1).optional());
const text = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const nullableText = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional();

const fileInput = z.object({
  key: z.string().min(10).max(400),
  originalName: z.string().min(1).max(300),
  mimeType: z.string().min(3).max(120),
  sizeBytes: z.coerce.number().int().positive().max(50 * 1024 * 1024),
});

const status = z.enum(['VALID', 'EXPIRING_SOON', 'EXPIRED', 'NO_EXPIRY']);

const registerQuery = {
  firmId: z.string().optional(),
  q: text(100),
  ownership: z.preprocess(blankToUndefined, z.enum(['OWNED', 'RENTED']).optional()),
  machineCategory: optId,
  category: z.preprocess(blankToUndefined, z.enum(['COMPLIANCE', 'OPERATOR', 'PURCHASE', 'RENTAL', 'SERVICE', 'OTHER']).optional()),
  typeId: optId,
  status: z.preprocess(blankToUndefined, status.optional()),
  withinDays: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(365).optional()),
  machineId: optId,
  includeInactive: bool,
};

export const registerSchema = z.object({
  query: z.object({
    ...registerQuery,
    view: z.preprocess(blankToUndefined, z.enum(['documents', 'machines']).optional()),
    page: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).optional()),
    limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(200).optional()),
  }),
});

export const exportSchema = z.object({ query: z.object(registerQuery) });

export const countsSchema = z.object({ query: z.object({ firmId: z.string().optional(), perMachine: bool }) });

export const machineDocsSchema = z.object({ params: z.object({ machineId: z.string().min(1) }) });

export const typesSchema = z.object({ query: z.object({ machineId: optId }) });

export const createTypeSchema = z.object({
  body: z.object({
    firmId: z.union([z.string(), z.number()]),
    name: z.string().trim().min(2).max(80),
    category: z.enum(['COMPLIANCE', 'OPERATOR', 'PURCHASE', 'RENTAL', 'SERVICE', 'OTHER']),
    hasValidity: z.enum(['REQUIRED', 'OPTIONAL', 'NONE']),
    appliesTo: z.enum(['OWNED', 'RENTED', 'BOTH']).optional(),
    singleCurrent: z.boolean().optional(),
    costSensitive: z.boolean().optional(),
    allowMultipleFiles: z.boolean().optional(),
  }),
});

const target = {
  machineId: optId,
  ownerUserId: optBigId,
  firmId: optBigId,
  documentTypeId: z.string().min(1, 'Choose a document type'),
};

export const presignSchema = z.object({
  body: z.object({
    ...target,
    // a file attached through a work-order / repair / outsourcing dialog: the person may create work orders on this machine
    purpose: z.preprocess(blankToUndefined, z.enum(['work_order']).optional()),
    files: z
      .array(z.object({ name: z.string().min(1).max(300), mimeType: z.string().min(3).max(120), sizeBytes: z.coerce.number().int().positive() }))
      .min(1)
      .max(20),
  }),
});

export const createDocumentSchema = z.object({
  body: z.object({
    ...target,
    clientRequestId: z.preprocess(blankToUndefined, z.string().trim().min(8).max(100).optional()),
    title: text(200),
    documentNumber: text(100),
    issuer: text(150),
    issuedAt: optDay,
    validFrom: optDay,
    validTill: optDay,
    amount: z.preprocess(blankToUndefined, z.coerce.number().min(0).max(1e10).optional()),
    remarks: text(500),
    workOrderId: optId,
    renewsDocumentId: optId,
    files: z.array(fileInput).min(1).max(20),
  }),
});

export const updateDocumentSchema = z.object({
  params: idParams,
  body: z.object({
    title: z.string().trim().max(200).optional(),
    documentNumber: nullableText(100),
    issuer: nullableText(150),
    issuedAt: nullableDay,
    validFrom: nullableDay,
    validTill: nullableDay,
    amount: z.union([z.coerce.number().min(0).max(1e10), z.null()]).optional(),
    remarks: nullableText(500),
  }),
});

export const changeFilesSchema = z.object({
  params: idParams,
  body: z.object({ mode: z.enum(['replace', 'add']), files: z.array(fileInput).min(1).max(20) }),
});

export const voidDocumentSchema = z.object({
  params: idParams,
  body: z.object({ reason: z.string().trim().min(3, 'give a reason (at least 3 characters)').max(300) }),
});

export const documentIdSchema = z.object({ params: idParams });

export const downloadSchema = z.object({ params: z.object({ fileId: z.string().min(1) }), query: z.object({ inline: bool }) });

export { bigId };
