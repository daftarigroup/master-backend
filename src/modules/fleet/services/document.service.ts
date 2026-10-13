// The ONE document service for machines and operators: Equipment Documents, the fleet register, Maintenance Records, Asset Detail and
// the work-order / repair upload dialogs all go through it. Status, tab counts, banners, tiles and badges come from the same
// `evaluate()` pass over the same rows, so they always reconcile. Documents are never hard-deleted: void with a reason.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { getAwsConfigStatus } from '../../../config/index';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, firmWhere, requireSingleFirm, resolveFirmScope } from '../../../utils/firmScope';
import { buildS3PublicUrl, extractS3KeyFromUrl, getPresignedGetUrl, getPresignedPutUrl, headObjectFromS3 } from '../../../services/s3.service';
import { isInFleet } from '../cost/utilization';
import { Relation, TypeFlags, canEdit, canSeeType, canUpload, canVoid, loadActor, DocActor } from '../lib/documentAccess';
import { MAX_IMAGES_PER_SET, checkFile, isImageMime, keyPrefix, newKey, sanitizeFileName } from '../lib/documentFiles';
import {
  DEFAULT_WINDOW_DAYS, DocStatus, STATUS_RANK, StatusResult, addDays, agreementEndsBeforeHire, bannerNames, documentStatus, downloadName, latestIds, splitCurrent,
} from '../lib/documentStatus';
import { toIstDateString } from '../lib/istDate';
import { activeOperatorWhere, machineAccessWhere } from '../lib/machineAccess';
import { Db, activeAssignmentOf, loadMachineInScope, requireUserId } from './common';
import { statusesFor } from './machineStatus';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dec = (v: Prisma.Decimal | null) => (v === null ? null : Number(v));
const CLOSED_ORDERS = ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] as const;

const include = {
  documentType: true,
  files: { orderBy: { sortOrder: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  ownerUser: { select: { id: true, name: true } },
  workOrder: { select: { id: true, workOrderCode: true } },
  machine: {
    select: {
      id: true, name: true, assetCode: true, category: true, equipmentType: true, ownershipType: true, firmId: true, status: true, isActive: true,
      rentalEndAt: true, imageUrl: true, location: true, defaultResponsibleId: true,
      asset: { select: { status: true } },
      siteLocation: { select: { location: true } },
    },
  },
} satisfies Prisma.MachineDocumentInclude;
type DocRec = Prisma.MachineDocumentGetPayload<{ include: typeof include }>;
type MachineRec = NonNullable<DocRec['machine']>;

const typeFlags = (t: DocRec['documentType']): TypeFlags => ({ category: t.category, costSensitive: t.costSensitive, personal: t.personal });

interface Ev {
  rec: DocRec;
  validTill: string | null;
  issuedAt: string | null;
  uploadedAt: string;
  st: StatusResult;
  windowDays: number;
  current: boolean;
  latest: boolean;
  groupKey: string;
}

async function windowsFor(firmIds: Array<bigint | null>): Promise<Map<string, number>> {
  const ids = [...new Set(firmIds.filter((f): f is bigint => f !== null))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.fleetSettings.findMany({ where: { firmId: { in: ids } }, select: { firmId: true, documentExpiryWindowDays: true } });
  return new Map(rows.map((r) => [String(r.firmId), r.documentExpiryWindowDays]));
}

/** Status, current/history and "Latest" for a set of non-voided documents. The single evaluation pass behind every count. */
async function evaluate(docs: DocRec[], today: string): Promise<Ev[]> {
  const windows = await windowsFor(docs.map((d) => d.machine?.firmId ?? d.firmId));
  const base = docs.map((rec) => ({
    rec,
    id: rec.id,
    groupKey: rec.ownerType === 'OPERATOR' ? `u:${rec.ownerUserId}:${rec.documentTypeId}` : `m:${rec.machineId}:${rec.documentTypeId}`,
    singleCurrent: rec.documentType.singleCurrent,
    validTill: iso(rec.validTill),
    issuedAt: iso(rec.issuedAt),
    createdAt: rec.createdAt.toISOString(),
  }));
  const { current } = splitCurrent(base);
  const currentIds = new Set(current.map((c) => c.id));
  const latest = latestIds(base.filter((b) => currentIds.has(b.id) && b.rec.documentType.category === 'SERVICE' && b.rec.documentType.hasValidity === 'NONE' && !b.rec.documentType.allowMultipleFiles));
  return base.map((b) => {
    const firm = b.rec.machine?.firmId ?? b.rec.firmId;
    const windowDays = b.rec.documentType.expiryLeadDays ?? (firm === null ? DEFAULT_WINDOW_DAYS : (windows.get(String(firm)) ?? DEFAULT_WINDOW_DAYS));
    return {
      rec: b.rec, validTill: b.validTill, issuedAt: b.issuedAt, uploadedAt: b.createdAt, windowDays, groupKey: b.groupKey,
      st: documentStatus({ validTill: b.validTill }, today, windowDays), current: currentIds.has(b.id), latest: latest.has(b.id),
    };
  });
}

const machineInFleet = (m: MachineRec | null, today: string) =>
  m === null || (m.isActive && isInFleet({ rentalEndDate: m.rentalEndAt ? toIstDateString(m.rentalEndAt) : null }, m.status, m.asset?.status ?? null, today));

/** Documents the caller may see: machine in scope, cost-sensitive hidden without cost access, personal ones only to admins / the owner. */
async function visibleWhere(ctx: UserAuthContext, actor: DocActor, firmId?: unknown): Promise<Prisma.MachineDocumentWhereInput> {
  const scope = resolveFirmScope(ctx, firmId);
  const operatorPart: Prisma.MachineDocumentWhereInput = {
    ownerType: 'OPERATOR',
    OR: [...(actor.admin ? [{ ...firmWhere(scope, 'firmId') }] : []), ...(actor.userId !== null ? [{ ownerUserId: actor.userId }] : [])],
  };
  return {
    voidedAt: null,
    AND: [
      { OR: [{ ownerType: 'MACHINE', machine: { is: await machineAccessWhere(ctx, firmId) } }, operatorPart] },
      actor.canCost ? {} : { documentType: { costSensitive: false } },
      actor.admin ? {} : { OR: [{ documentType: { personal: false } }, ...(actor.userId !== null ? [{ ownerUserId: actor.userId }] : [])] },
    ],
  };
}

async function worksOnMachine(ctx: UserAuthContext, machineId: string): Promise<boolean> {
  const me = ctx.userId;
  if (me === null) return false;
  const [op, assign, m, wo] = await Promise.all([
    prisma.machineOperatorAssignment.findFirst({ where: { machineId, userId: me, ...activeOperatorWhere() }, select: { id: true } }),
    prisma.machineAssignment.findFirst({ where: { machineId, endedAt: null, responsibleUserId: me }, select: { id: true } }),
    prisma.machine.findFirst({ where: { id: machineId, OR: [{ defaultResponsibleId: me }, { defaultMechanicId: me }] }, select: { id: true } }),
    prisma.maintenanceWorkOrder.findFirst({ where: { machineId, currentAssigneeUserId: me, status: { notIn: [...CLOSED_ORDERS] } }, select: { id: true } }),
  ]);
  return Boolean(op || assign || m || wo);
}

async function signedOrPlain(key: string, plainUrl: string, filename?: string): Promise<string> {
  if (!getAwsConfigStatus().configured) return plainUrl;
  try {
    return await getPresignedGetUrl(key, 900, filename ? { filename } : undefined);
  } catch {
    return plainUrl;
  }
}

async function toRow(ev: Ev, actor: DocActor, opts: { withPreview?: boolean | 'all'; readOnly?: boolean } = {}) {
  const r = ev.rec;
  const t = r.documentType;
  const files = await Promise.all(
    r.files.map(async (f, i) => ({
      id: f.id, originalName: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes, isImage: isImageMime(f.mimeType),
      previewUrl: opts.withPreview && isImageMime(f.mimeType) && (opts.withPreview === 'all' || i < 3) ? await signedOrPlain(f.key, f.url) : null,
    })),
  );
  return {
    id: r.id,
    ownerType: r.ownerType,
    ownerUser: r.ownerUser ? { id: String(r.ownerUser.id), name: r.ownerUser.name } : null,
    machine: r.machine ? { id: r.machine.id, name: r.machine.name, assetCode: r.machine.assetCode, ownershipType: r.machine.ownershipType } : null,
    type: { id: t.id, code: t.code, name: t.name, category: t.category, hasValidity: t.hasValidity, costSensitive: t.costSensitive, personal: t.personal, allowMultipleFiles: t.allowMultipleFiles, singleCurrent: t.singleCurrent },
    title: r.title,
    documentNumber: r.documentNumber,
    issuer: r.issuer,
    issuedAt: ev.issuedAt,
    validFrom: iso(r.validFrom),
    validTill: ev.validTill,
    amount: actor.canCost && t.costSensitive ? dec(r.amount) : undefined,
    remarks: r.remarks,
    status: ev.st.status,
    daysLeft: ev.st.daysLeft,
    statusLabel: ev.st.label,
    windowDays: ev.windowDays,
    isLatest: ev.latest,
    isCurrent: ev.current,
    files,
    fileCount: r.files.length,
    uploadedBy: r.createdBy ? { id: String(r.createdBy.id), name: r.createdBy.name } : null,
    uploadedAt: ev.uploadedAt,
    workOrder: r.workOrder ? { id: r.workOrder.id, code: r.workOrder.workOrderCode } : null,
    sourceType: r.sourceType,
    canEdit: !opts.readOnly && canEdit(actor, typeFlags(t), r),
    canRenew: !opts.readOnly && t.singleCurrent && canEdit(actor, typeFlags(t), r),
    canVoid: !opts.readOnly && canVoid(actor),
  };
}

type Row = Awaited<ReturnType<typeof toRow>>;

const byUrgency = (a: Row, b: Row) =>
  STATUS_RANK[a.status as DocStatus] - STATUS_RANK[b.status as DocStatus] ||
  (a.validTill ?? '9999').localeCompare(b.validTill ?? '9999') ||
  (a.machine?.name ?? '').localeCompare(b.machine?.name ?? '') ||
  a.title.localeCompare(b.title);

const CATEGORY_ORDER = ['COMPLIANCE', 'OPERATOR', 'RENTAL', 'PURCHASE', 'SERVICE', 'OTHER'];

export interface RegisterQuery {
  firmId?: unknown;
  q?: string;
  ownership?: 'OWNED' | 'RENTED';
  machineCategory?: string;
  category?: string;
  typeId?: string;
  status?: DocStatus;
  withinDays?: number;
  machineId?: string;
  includeInactive?: boolean;
  view?: 'documents' | 'machines';
  page?: number;
  limit?: number;
}

async function loadRegister(ctx: UserAuthContext, actor: DocActor, q: RegisterQuery, today: string) {
  const search = q.q?.trim();
  const and: Prisma.MachineDocumentWhereInput[] = [await visibleWhere(ctx, actor, q.firmId)];
  if (q.category) and.push({ documentType: { category: q.category as DocRec['documentType']['category'] } });
  if (q.typeId) and.push({ documentTypeId: q.typeId });
  if (q.machineId) and.push({ machineId: q.machineId });
  if (q.ownership) and.push({ machine: { is: { ownershipType: q.ownership } } });
  if (q.machineCategory) and.push({ machine: { is: { equipmentType: q.machineCategory as MachineRec['equipmentType'] } } });
  if (search) {
    const c = { contains: search, mode: 'insensitive' as const };
    and.push({ OR: [{ title: c }, { documentNumber: c }, { issuer: c }, { files: { some: { originalName: c } } }, { machine: { is: { OR: [{ name: c }, { assetCode: c }] } } }, { ownerUser: { is: { name: c } } }] });
  }
  const docs = await prisma.machineDocument.findMany({ where: { AND: and }, include });
  let evs = (await evaluate(docs, today)).filter((e) => e.current);
  if (!q.includeInactive) evs = evs.filter((e) => machineInFleet(e.rec.machine, today));
  if (q.withinDays !== undefined) {
    const limit = addDays(today, q.withinDays);
    evs = evs.filter((e) => e.validTill !== null && e.validTill >= today && e.validTill <= limit);
  }
  return evs;
}

function statsOf(evs: Ev[]) {
  const expired = evs.filter((e) => e.st.status === 'EXPIRED');
  return {
    total: evs.length,
    expiringSoon: evs.filter((e) => e.st.status === 'EXPIRING_SOON').length,
    expired: expired.length,
    machinesWithExpired: new Set(expired.map((e) => e.rec.machineId).filter(Boolean)).size,
  };
}

// ---- file helpers ------------------------------------------------------------------------------------------------------------------
export interface FileInput {
  key: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

async function verifyUploaded(files: FileInput[]) {
  if (!getAwsConfigStatus().configured) return;
  for (const f of files) {
    let head;
    try {
      head = await headObjectFromS3(f.key);
    } catch {
      throw ApiError.badRequest(`"${sanitizeFileName(f.originalName)}" was not uploaded. Please try the upload again.`);
    }
    if (head.ContentLength !== undefined && head.ContentLength > 0 && Math.abs(head.ContentLength - f.sizeBytes) > 0) {
      throw ApiError.badRequest(`"${sanitizeFileName(f.originalName)}" does not match the uploaded file. Please upload it again.`);
    }
  }
}

function validateFiles(t: DocRec['documentType'], files: FileInput[], owner: { machineId?: string | null; ownerUserId?: bigint | null }) {
  if (files.length === 0) throw ApiError.badRequest('Add at least one file');
  if (!t.allowMultipleFiles && files.length > 1) throw ApiError.badRequest(`${t.name} takes a single file`);
  if (files.length > MAX_IMAGES_PER_SET) throw ApiError.badRequest(`At most ${MAX_IMAGES_PER_SET} files per document`);
  const seen = new Set<string>();
  for (const f of files) {
    const err = checkFile({ name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes });
    if (err) throw ApiError.badRequest(err);
    if (!f.key.startsWith('documents/') || !f.key.includes(owner.machineId ? `/machine-${owner.machineId}/` : `/operator-${owner.ownerUserId}/`) || f.key.includes('..')) {
      throw ApiError.badRequest('That file was not uploaded for this document. Please upload it again.');
    }
    if (seen.has(f.key)) throw ApiError.badRequest('The same file was added twice');
    seen.add(f.key);
  }
}

const fileRows = (files: FileInput[], startAt = 0) =>
  files.map((f, i) => ({ key: f.key, url: buildS3PublicUrl(f.key), originalName: sanitizeFileName(f.originalName), mimeType: f.mimeType.toLowerCase(), sizeBytes: Math.round(f.sizeBytes), sortOrder: startAt + i }));

async function loadType(ctx: UserAuthContext, id: string) {
  const t = await prisma.documentType.findFirst({ where: { id, active: true } });
  if (!t) throw ApiError.badRequest('Unknown document type');
  if (t.firmId !== null) {
    const scope = resolveFirmScope(ctx);
    if (!scope.all && !scope.firmIds.includes(t.firmId)) throw ApiError.badRequest('Unknown document type');
  }
  return t;
}

function assertApplies(t: DocRec['documentType'], machine: { ownershipType: string; equipmentType: string }) {
  if (t.appliesTo !== 'BOTH' && t.appliesTo !== machine.ownershipType) throw ApiError.badRequest(`${t.name} does not apply to ${machine.ownershipType === 'OWNED' ? 'owned' : 'hired'} machines`);
  if (t.machineCategories.length > 0 && !t.machineCategories.includes(machine.equipmentType)) throw ApiError.badRequest(`${t.name} does not apply to this kind of machine`);
}

interface Target {
  machine: MachineRec | null;
  ownerUserId: bigint | null;
  firmId: bigint;
}

async function resolveTarget(ctx: UserAuthContext, actor: DocActor, body: { machineId?: string | null; ownerUserId?: bigint | null; firmId?: bigint | null }): Promise<Target> {
  if (body.machineId) {
    const m = await loadMachineInScope(prisma, ctx, body.machineId);
    const full = await prisma.machine.findUniqueOrThrow({ where: { id: m.id }, select: include.machine.select });
    const firmId = m.firmId ?? (await activeAssignmentOf(prisma, m.id))?.firmId ?? null;
    if (firmId === null) throw ApiError.badRequest('This machine has no firm yet. Assign it to a firm before adding documents.');
    assertFirmWritable(ctx, firmId);
    return { machine: full, ownerUserId: null, firmId };
  }
  if (!body.ownerUserId) throw ApiError.badRequest('Choose a machine or an operator');
  if (!actor.editor) throw ApiError.forbidden('Only an admin or site engineer can add operator documents');
  if (!body.firmId) throw ApiError.badRequest('firmId is required for an operator document');
  assertFirmWritable(ctx, body.firmId);
  const u = await prisma.user.findUnique({ where: { id: body.ownerUserId }, select: { id: true } });
  if (!u) throw ApiError.badRequest('Operator not found');
  return { machine: null, ownerUserId: body.ownerUserId, firmId: body.firmId };
}

function assertWritableMachine(m: MachineRec | null, today: string) {
  if (m && !machineInFleet(m, today)) throw ApiError.conflict('This machine is disposed, inactive or released: its documents are read-only');
}

export interface CreateBody {
  clientRequestId?: string;
  firmId?: bigint | null;
  machineId?: string | null;
  ownerUserId?: bigint | null;
  documentTypeId: string;
  title?: string;
  documentNumber?: string;
  issuer?: string;
  issuedAt?: string | null;
  validFrom?: string | null;
  validTill?: string | null;
  amount?: number | null;
  remarks?: string;
  workOrderId?: string | null;
  renewsDocumentId?: string | null;
  files: FileInput[];
}

export const documentService = {
  // ---- types ----------------------------------------------------------------------------------------------------------------------
  async types(ctx: UserAuthContext, q: { machineId?: string }) {
    const actor = await loadActor(ctx);
    const scope = resolveFirmScope(ctx);
    const machine = q.machineId ? await loadMachineInScope(prisma, ctx, q.machineId) : null;
    const rows = await prisma.documentType.findMany({
      where: { active: true, OR: [{ firmId: null }, ...(scope.all ? [{ firmId: { not: null } }] : [{ firmId: { in: scope.firmIds } }])] },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows
      .filter((t) => canSeeType(actor, typeFlags(t), actor.editor))
      .filter((t) => !machine || ((t.appliesTo === 'BOTH' || t.appliesTo === machine.ownershipType) && (t.machineCategories.length === 0 || t.machineCategories.includes(machine.equipmentType))))
      .map((t) => ({ id: t.id, code: t.code, name: t.name, category: t.category, hasValidity: t.hasValidity, appliesTo: t.appliesTo, singleCurrent: t.singleCurrent, costSensitive: t.costSensitive, personal: t.personal, allowMultipleFiles: t.allowMultipleFiles, system: t.firmId === null }));
  },

  async createType(ctx: UserAuthContext, body: { firmId?: unknown; name: string; category: DocRec['documentType']['category']; hasValidity: DocRec['documentType']['hasValidity']; appliesTo?: DocRec['documentType']['appliesTo']; singleCurrent?: boolean; costSensitive?: boolean; allowMultipleFiles?: boolean }) {
    const actor = await loadActor(ctx);
    if (!actor.admin) throw ApiError.forbidden('Only an admin can add document types');
    const firmId = requireSingleFirm(ctx, body.firmId);
    assertFirmWritable(ctx, firmId);
    const code = body.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    if (!code) throw ApiError.badRequest('Give the type a name');
    const exists = await prisma.documentType.findFirst({ where: { code, OR: [{ firmId }, { firmId: null }] }, select: { id: true } });
    if (exists) throw ApiError.conflict('A document type with that name already exists');
    const t = await prisma.documentType.create({
      data: { firmId, code, name: body.name.trim(), category: body.category, hasValidity: body.hasValidity, appliesTo: body.appliesTo ?? 'BOTH', singleCurrent: body.singleCurrent ?? false, costSensitive: body.costSensitive ?? false, allowMultipleFiles: body.allowMultipleFiles ?? false, sortOrder: 500 },
    });
    return { id: t.id, code: t.code, name: t.name };
  },

  // ---- upload -----------------------------------------------------------------------------------------------------------------------
  /** Step 1 of an upload: validates type, size and permission, then hands out one short-lived PUT url per file under a per-firm / per-owner key. */
  async presign(ctx: UserAuthContext, body: { machineId?: string | null; ownerUserId?: bigint | null; firmId?: bigint | null; purpose?: 'work_order'; documentTypeId: string; files: Array<{ name: string; mimeType: string; sizeBytes: number }> }) {
    requireUserId(ctx);
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const target = await resolveTarget(ctx, actor, body);
    assertWritableMachine(target.machine, today);
    const t = await loadType(ctx, body.documentTypeId);
    if (target.machine) assertApplies(t, target.machine);
    const rel: Relation = { worksOnMachine: target.machine ? body.purpose === 'work_order' || (await worksOnMachine(ctx, target.machine.id)) : false };
    if (!canUpload(actor, typeFlags(t), rel)) throw ApiError.forbidden('You cannot add this kind of document');
    if (body.files.length === 0) throw ApiError.badRequest('Add at least one file');
    if (!t.allowMultipleFiles && body.files.length > 1) throw ApiError.badRequest(`${t.name} takes a single file`);
    if (body.files.length > MAX_IMAGES_PER_SET) throw ApiError.badRequest(`At most ${MAX_IMAGES_PER_SET} files per document`);
    for (const f of body.files) {
      const err = checkFile(f);
      if (err) throw ApiError.badRequest(err);
    }
    if (!getAwsConfigStatus().configured || String(process.env.DISABLE_PRESIGNED_UPLOADS || '').toLowerCase() === 'true') {
      throw new ApiError(503, 'File upload is not available right now (storage is not configured).');
    }
    const prefix = keyPrefix(target.machine?.firmId ?? target.firmId, { machineId: target.machine?.id, ownerUserId: target.ownerUserId });
    return Promise.all(
      body.files.map(async (f) => {
        const key = newKey(prefix, f.name);
        return { key, publicUrl: buildS3PublicUrl(key), uploadUrl: await getPresignedPutUrl(key, f.mimeType.toLowerCase()), contentType: f.mimeType.toLowerCase(), originalName: sanitizeFileName(f.name), expiresIn: 300 };
      }),
    );
  },

  /** Step 2: saves the record. Idempotent per (firm, clientRequestId): a retry returns the existing document. */
  async create(ctx: UserAuthContext, body: CreateBody) {
    const userId = requireUserId(ctx);
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const target = await resolveTarget(ctx, actor, body);
    assertWritableMachine(target.machine, today);

    if (body.clientRequestId) {
      const prior = await prisma.machineDocument.findFirst({ where: { firmId: target.firmId, clientRequestId: body.clientRequestId }, select: { id: true } });
      if (prior) return { id: prior.id, idempotent: true };
    }

    const t = await loadType(ctx, body.documentTypeId);
    if (target.machine) assertApplies(t, target.machine);
    const rel: Relation = { worksOnMachine: target.machine ? await worksOnMachine(ctx, target.machine.id) : false };
    if (!canUpload(actor, typeFlags(t), rel)) throw ApiError.forbidden('You cannot add this kind of document');
    if (t.personal && !target.ownerUserId) throw ApiError.badRequest('Operator documents belong to an operator');
    if (!t.personal && !target.machine) throw ApiError.badRequest('Choose a machine for this document');

    const validTill = t.hasValidity === 'NONE' ? null : (body.validTill ?? null);
    if (t.hasValidity === 'REQUIRED' && !validTill) throw ApiError.badRequest(`${t.name} needs a Valid Till date`);
    const validFrom = body.validFrom ?? null;
    if (validFrom && validTill && validTill < validFrom) throw ApiError.badRequest('Valid Till is before the start date');
    const issuedAt = body.issuedAt ?? today;

    if (body.workOrderId && target.machine) {
      const wo = await prisma.maintenanceWorkOrder.findFirst({ where: { id: body.workOrderId, machineId: target.machine.id }, select: { id: true } });
      if (!wo) throw ApiError.badRequest('That work order does not belong to this machine');
    }
    if (body.renewsDocumentId) {
      const old = await prisma.machineDocument.findFirst({ where: { id: body.renewsDocumentId, voidedAt: null, documentTypeId: t.id, ...(target.machine ? { machineId: target.machine.id } : { ownerUserId: target.ownerUserId }) }, select: { id: true } });
      if (!old) throw ApiError.badRequest('The document being renewed was not found');
    }

    validateFiles(t, body.files, { machineId: target.machine?.id, ownerUserId: target.ownerUserId });
    await verifyUploaded(body.files);

    try {
      const doc = await prisma.$transaction(async (tx) => {
        const created = await tx.machineDocument.create({
          data: {
            firmId: target.firmId,
            machineId: target.machine?.id ?? null,
            ownerType: target.machine ? 'MACHINE' : 'OPERATOR',
            ownerUserId: target.ownerUserId,
            workOrderId: body.workOrderId ?? null,
            documentTypeId: t.id,
            title: body.title?.trim() || t.name,
            documentNumber: body.documentNumber?.trim() || null,
            issuer: body.issuer?.trim() || null,
            issuedAt: new Date(issuedAt),
            validFrom: validFrom ? new Date(validFrom) : null,
            validTill: validTill ? new Date(validTill) : null,
            amount: t.costSensitive && actor.canCost && body.amount != null ? body.amount : null,
            remarks: body.remarks?.trim() || null,
            sourceType: body.workOrderId ? 'WORK_ORDER' : 'UPLOAD',
            clientRequestId: body.clientRequestId ?? null,
            renewsDocumentId: body.renewsDocumentId ?? null,
            createdById: userId,
            files: { create: fileRows(body.files) },
          },
        });
        await tx.machineDocumentEvent.create({ data: { documentId: created.id, event: 'CREATED', actorId: userId, meta: { type: t.code, files: body.files.length, ...(body.renewsDocumentId ? { renews: body.renewsDocumentId } : {}) } } });
        return created;
      });
      return { id: doc.id, idempotent: false };
    } catch (e) {
      // two taps at once: the unique (firm, clientRequestId) index lets exactly one through
      if (body.clientRequestId && (e as { code?: string }).code === 'P2002') {
        const prior = await prisma.machineDocument.findFirst({ where: { firmId: target.firmId, clientRequestId: body.clientRequestId }, select: { id: true } });
        if (prior) return { id: prior.id, idempotent: true };
      }
      throw e;
    }
  },

  /**
   * Registers a file that is ALREADY in storage (a work-order / repair / outsource dialog, or the machine form) as one document, so it
   * appears in Equipment Documents with no second upload. Idempotent on `sourceRef`; a changed url replaces the file.
   */
  async registerUrl(db: Db, args: { machineId: string; firmId: bigint | null; workOrderId?: string | null; typeCode: string; title: string; url: string | null | undefined; sourceType: 'WORK_ORDER' | 'MIGRATED' | 'UPLOAD'; sourceRef: string; actorId: bigint | null }) {
    const url = args.url?.trim();
    if (!url) return null;
    const type = await db.documentType.findFirst({ where: { code: args.typeCode, firmId: null } });
    if (!type) return null;
    const key = extractS3KeyFromUrl(url);
    const name = decodeURIComponentSafe(key.split('/').pop() ?? 'file');
    const file = { key, url, originalName: sanitizeFileName(name), mimeType: guessMime(name), sortOrder: 0 };
    const existing = await db.machineDocument.findFirst({ where: { sourceRef: args.sourceRef }, include: { files: true } });
    if (existing) {
      if (existing.voidedAt || existing.files[0]?.url === url) return existing.id;
      await db.machineDocumentFile.deleteMany({ where: { documentId: existing.id } });
      await db.machineDocumentFile.create({ data: { documentId: existing.id, ...file } });
      await db.machineDocumentEvent.create({ data: { documentId: existing.id, event: 'FILE_REPLACED', actorId: args.actorId, meta: { from: existing.files[0]?.key ?? null } } });
      return existing.id;
    }
    const created = await db.machineDocument.create({
      data: {
        firmId: args.firmId, machineId: args.machineId, workOrderId: args.workOrderId ?? null, ownerType: 'MACHINE', documentTypeId: type.id, title: args.title,
        issuedAt: new Date(toIstDateString(new Date())), sourceType: args.sourceType, sourceRef: args.sourceRef, createdById: args.actorId,
        files: { create: [file] },
      },
    });
    await db.machineDocumentEvent.create({ data: { documentId: created.id, event: 'CREATED', actorId: args.actorId, meta: { from: args.sourceRef.split(':')[0] } } });
    return created.id;
  },

  /** A work-order attachment (service document, bill or photos). The order keeps its own link; this registers the same file once. */
  async mirrorWorkOrderFile(db: Db, args: { workOrderId: string; field: 'documentUrl' | 'billUrl' | 'photoUrl'; url: string | null | undefined; actorId: bigint | null }) {
    if (!args.url?.trim()) return null;
    const wo = await db.maintenanceWorkOrder.findUnique({ where: { id: args.workOrderId }, select: { id: true, firmId: true, machineId: true, workOrderCode: true } });
    if (!wo) return null;
    const label = args.field === 'billUrl' ? 'Vendor bill' : args.field === 'photoUrl' ? 'Service photos' : 'Service document';
    return this.registerUrl(db, {
      machineId: wo.machineId, firmId: wo.firmId, workOrderId: wo.id, url: args.url, actorId: args.actorId, sourceType: 'WORK_ORDER', sourceRef: `wo:${wo.id}:${args.field}`,
      typeCode: args.field === 'billUrl' ? 'VENDOR_BILL' : args.field === 'photoUrl' ? 'MAINTENANCE_PHOTOS' : 'SERVICE_REPORT',
      title: `${label} (${wo.workOrderCode ?? wo.id})`,
    });
  },

  /** Files given on the old machine form (manual, spec sheet, other documents) become documents; the machine's documentUrls column is no longer written. */
  async registerMachineFormFiles(db: Db, args: { machineId: string; firmId: bigint | null; actorId: bigint | null; manualUrl?: string | null; specUrl?: string | null; documentUrls?: unknown }) {
    const items: Array<{ url: string; title: string; code: string }> = [];
    if (args.manualUrl) items.push({ url: args.manualUrl, title: 'Manual', code: 'MANUAL' });
    if (args.specUrl) items.push({ url: args.specUrl, title: 'Specification sheet', code: 'MANUAL' });
    for (const raw of Array.isArray(args.documentUrls) ? args.documentUrls : []) {
      if (typeof raw !== 'string' || !raw.trim()) continue;
      let url = raw.trim();
      let title = 'Document';
      if (url.startsWith('{')) {
        try {
          const j = JSON.parse(url) as { url?: string; description?: string };
          if (!j.url) continue;
          url = j.url;
          title = j.description?.trim() || title;
        } catch {
          continue;
        }
      }
      items.push({ url, title, code: 'OTHER' });
    }
    for (const it of items) {
      await this.registerUrl(db, { machineId: args.machineId, firmId: args.firmId, url: it.url, typeCode: it.code, title: it.title, sourceType: 'UPLOAD', sourceRef: `mform:${args.machineId}:${extractS3KeyFromUrl(it.url)}`, actorId: args.actorId });
    }
  },

  // ---- reads ------------------------------------------------------------------------------------------------------------------------
  /** Equipment Documents for one machine: tabs, banners, rows and history, all from one pass. */
  async forMachine(ctx: UserAuthContext, machineId: string) {
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const m = await loadMachineInScope(prisma, ctx, machineId);
    const machine = await prisma.machine.findUniqueOrThrow({ where: { id: m.id }, select: { id: true, name: true, assetCode: true, ownershipType: true, equipmentType: true, firmId: true, status: true, isActive: true, rentalEndAt: true, defaultResponsibleId: true, imageUrl: true, location: true, siteLocation: { select: { location: true } }, asset: { select: { status: true } } } });
    const derived = (await statusesFor([machine], today)).status.get(machine.id) ?? 'IDLE';
    const readOnly = !(machine.isActive && isInFleet({ rentalEndDate: machine.rentalEndAt ? toIstDateString(machine.rentalEndAt) : null }, machine.status, machine.asset?.status ?? null, today));

    const where = await visibleWhere(ctx, actor);
    const docs = await prisma.machineDocument.findMany({ where: { AND: [where, { machineId: machine.id, ownerType: 'MACHINE' }] }, include });

    // the current operators' licences: shown for the people allowed to see them (admins, the operator, the responsible person)
    const ops = await prisma.machineOperatorAssignment.findMany({ where: { machineId: machine.id, ...activeOperatorWhere(today) }, select: { userId: true } });
    const assignment = await activeAssignmentOf(prisma, machine.id);
    const responsible = ctx.userId !== null && (assignment?.responsibleUserId === ctx.userId || machine.defaultResponsibleId === ctx.userId);
    let opDocs: DocRec[] = [];
    if (ops.length > 0) {
      opDocs = await prisma.machineDocument.findMany({
        where: { voidedAt: null, ownerType: 'OPERATOR', ownerUserId: { in: ops.map((o) => o.userId) }, ...(actor.admin || responsible ? {} : { ownerUserId: ctx.userId ?? -1n }) },
        include,
      });
    }

    const evs = await evaluate([...docs, ...opDocs], today);
    const currentEvs = evs.filter((e) => e.current);
    const historyEvs = evs.filter((e) => !e.current);
    const rows = (await Promise.all(currentEvs.map((e) => toRow(e, actor, { withPreview: true, readOnly })))).sort(byUrgency);
    const history = (await Promise.all(historyEvs.map((e) => toRow(e, actor, { readOnly })))).sort((a, b) => (b.validTill ?? '').localeCompare(a.validTill ?? ''));

    const expiring = rows.filter((r) => r.status === 'EXPIRING_SOON');
    const expired = rows.filter((r) => r.status === 'EXPIRED');
    const agreement = rows.find((r) => r.type.code === 'RENTAL_AGREEMENT');

    return {
      machineId: machine.id,
      machine: { id: machine.id, firmId: (machine.firmId ?? assignment?.firmId ?? null)?.toString() ?? null, name: machine.name, assetCode: machine.assetCode, category: machine.equipmentType, ownershipType: machine.ownershipType, imageUrl: machine.imageUrl, status: derived, site: machine.siteLocation?.location ?? machine.location ?? null },
      today,
      readOnly,
      tabs: { all: rows.length, expiringSoon: expiring.length, expired: expired.length },
      // no alerts for a disposed, inactive or released machine
      banners: readOnly
        ? { expiring: null, expired: null }
        : {
            expiring: expiring.length ? { count: expiring.length, windowDays: Math.max(...expiring.map((r) => r.windowDays)), names: bannerNames(expiring.map((r) => r.type.name)) } : null,
            expired: expired.length ? { count: expired.length, names: bannerNames(expired.map((r) => r.type.name)) } : null,
          },
      agreementEndsBeforeHire: machine.ownershipType === 'RENTED' ? agreementEndsBeforeHire(agreement?.validTill ?? null, machine.rentalEndAt ? toIstDateString(machine.rentalEndAt) : null) : false,
      canUpload: !readOnly && actor.userId !== null,
      documents: rows,
      history,
    };
  },

  /** Fleet register (and the By-machine view). Tiles count the filtered set WITHOUT the status filter, so tapping a tile gives that count. */
  async register(ctx: UserAuthContext, q: RegisterQuery) {
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const evs = await loadRegister(ctx, actor, q, today);
    const stats = statsOf(evs);
    const filtered = q.status ? evs.filter((e) => e.st.status === q.status) : evs;
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    const offset = (Math.max(q.page ?? 1, 1) - 1) * limit;

    if (q.view === 'machines') {
      const byMachine = new Map<string, { machine: MachineRec; evs: Ev[] }>();
      for (const e of filtered) {
        if (!e.rec.machine || !e.rec.machineId) continue;
        const g = byMachine.get(e.rec.machineId) ?? { machine: e.rec.machine, evs: [] };
        g.evs.push(e);
        byMachine.set(e.rec.machineId, g);
      }
      const machines = [...byMachine.values()]
        .map((g) => {
          const count = (s: DocStatus) => g.evs.filter((e) => e.st.status === s).length;
          const worst = (['EXPIRED', 'EXPIRING_SOON', 'VALID', 'NO_EXPIRY'] as DocStatus[]).find((s) => count(s) > 0) ?? 'NO_EXPIRY';
          return { machineId: g.machine.id, name: g.machine.name, assetCode: g.machine.assetCode, ownershipType: g.machine.ownershipType, valid: count('VALID'), expiringSoon: count('EXPIRING_SOON'), expired: count('EXPIRED'), noExpiry: count('NO_EXPIRY'), total: g.evs.length, worst };
        })
        .sort((a, b) => STATUS_RANK[a.worst] - STATUS_RANK[b.worst] || b.expired - a.expired || b.expiringSoon - a.expiringSoon || a.name.localeCompare(b.name));
      return { today, stats, view: 'machines' as const, total: machines.length, items: machines.slice(offset, offset + limit) };
    }

    const rows = (await Promise.all(filtered.map((e) => toRow(e, actor)))).sort(byUrgency);
    return { today, stats, view: 'documents' as const, total: rows.length, items: rows.slice(offset, offset + limit) };
  },

  /** Sidebar badge, dashboard alert and Equipment Master chips: the same numbers as the register tiles. */
  async counts(ctx: UserAuthContext, q: { firmId?: unknown; perMachine?: boolean }) {
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const evs = await loadRegister(ctx, actor, { firmId: q.firmId }, today);
    const perMachine: Record<string, { expired: number; expiringSoon: number }> = {};
    if (q.perMachine) {
      for (const e of evs) {
        if (!e.rec.machineId || (e.st.status !== 'EXPIRED' && e.st.status !== 'EXPIRING_SOON')) continue;
        const p = (perMachine[e.rec.machineId] ??= { expired: 0, expiringSoon: 0 });
        if (e.st.status === 'EXPIRED') p.expired += 1;
        else p.expiringSoon += 1;
      }
    }
    return { ...statsOf(evs), ...(q.perMachine ? { perMachine } : {}) };
  },

  /** One document with its other versions and its audit trail (the trail is for editors). */
  async detail(ctx: UserAuthContext, id: string) {
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const doc = await findVisible(ctx, actor, id);
    const siblings = await prisma.machineDocument.findMany({
      where: { documentTypeId: doc.documentTypeId, ...(doc.machineId ? { machineId: doc.machineId } : { ownerUserId: doc.ownerUserId }) },
      include, orderBy: { createdAt: 'desc' },
    });
    const evs = await evaluate(siblings.filter((s) => !s.voidedAt), today);
    const self = evs.find((e) => e.rec.id === doc.id);
    const events = actor.editor
      ? await prisma.machineDocumentEvent.findMany({ where: { documentId: id }, orderBy: { at: 'desc' }, take: 100, include: { actor: { select: { id: true, name: true } } } })
      : [];
    const readOnly = !machineInFleet(doc.machine, today);
    const evFallback: Ev = self ?? { rec: doc, validTill: iso(doc.validTill), issuedAt: iso(doc.issuedAt), uploadedAt: doc.createdAt.toISOString(), st: documentStatus({ validTill: iso(doc.validTill) }, today), windowDays: DEFAULT_WINDOW_DAYS, current: false, latest: false, groupKey: '' };
    return {
      document: { ...(await toRow(evFallback, actor, { withPreview: 'all', readOnly })), voidedAt: doc.voidedAt?.toISOString() ?? null, voidReason: doc.voidReason },
      versions: await Promise.all(
        siblings.map(async (s) => {
          const e = evs.find((x) => x.rec.id === s.id);
          return { id: s.id, validTill: iso(s.validTill), issuedAt: iso(s.issuedAt), uploadedAt: s.createdAt.toISOString(), documentNumber: s.documentNumber, status: e ? e.st.status : ('VOIDED' as const), isCurrent: Boolean(e?.current), voided: Boolean(s.voidedAt) };
        }),
      ),
      events: events.map((e) => ({ id: e.id, event: e.event, at: e.at.toISOString(), actor: e.actor ? { id: String(e.actor.id), name: e.actor.name } : null, meta: e.meta })),
    };
  },

  // ---- changes -----------------------------------------------------------------------------------------------------------------------
  async update(ctx: UserAuthContext, id: string, body: { title?: string; documentNumber?: string | null; issuer?: string | null; issuedAt?: string | null; validFrom?: string | null; validTill?: string | null; amount?: number | null; remarks?: string | null }) {
    const userId = requireUserId(ctx);
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const doc = await findVisible(ctx, actor, id);
    if (!canEdit(actor, typeFlags(doc.documentType), doc)) throw ApiError.forbidden('You cannot change this document');
    assertWritableMachine(doc.machine, today);
    const t = doc.documentType;
    const validTill = body.validTill !== undefined ? (t.hasValidity === 'NONE' ? null : body.validTill) : iso(doc.validTill);
    const validFrom = body.validFrom !== undefined ? body.validFrom : iso(doc.validFrom);
    if (t.hasValidity === 'REQUIRED' && !validTill) throw ApiError.badRequest(`${t.name} needs a Valid Till date`);
    if (validFrom && validTill && validTill < validFrom) throw ApiError.badRequest('Valid Till is before the start date');
    const data: Prisma.MachineDocumentUncheckedUpdateInput = {};
    const changed: string[] = [];
    const set = <K extends keyof Prisma.MachineDocumentUncheckedUpdateInput>(k: K, v: Prisma.MachineDocumentUncheckedUpdateInput[K], differs: boolean) => {
      if (differs) {
        data[k] = v;
        changed.push(String(k));
      }
    };
    if (body.title !== undefined) set('title', body.title.trim() || t.name, (body.title.trim() || t.name) !== doc.title);
    if (body.documentNumber !== undefined) set('documentNumber', body.documentNumber?.trim() || null, (body.documentNumber?.trim() || null) !== doc.documentNumber);
    if (body.issuer !== undefined) set('issuer', body.issuer?.trim() || null, (body.issuer?.trim() || null) !== doc.issuer);
    if (body.issuedAt !== undefined) set('issuedAt', body.issuedAt ? new Date(body.issuedAt) : null, body.issuedAt !== iso(doc.issuedAt));
    set('validFrom', validFrom ? new Date(validFrom) : null, validFrom !== iso(doc.validFrom));
    set('validTill', validTill ? new Date(validTill) : null, validTill !== iso(doc.validTill));
    if (body.remarks !== undefined) set('remarks', body.remarks?.trim() || null, (body.remarks?.trim() || null) !== doc.remarks);
    if (body.amount !== undefined && t.costSensitive && actor.canCost) set('amount', body.amount, body.amount !== dec(doc.amount));
    if (changed.length === 0) return { id, changed: [] as string[] };
    await prisma.$transaction([
      prisma.machineDocument.update({ where: { id }, data }),
      prisma.machineDocumentEvent.create({ data: { documentId: id, event: 'UPDATED', actorId: userId, meta: { fields: changed } } }),
    ]);
    return { id, changed };
  },

  /** Replace every file of a document, or (photo sets) add to it. The old objects are kept in storage; the event records their keys. */
  async changeFiles(ctx: UserAuthContext, id: string, body: { mode: 'replace' | 'add'; files: FileInput[] }) {
    const userId = requireUserId(ctx);
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const doc = await findVisible(ctx, actor, id);
    if (!canEdit(actor, typeFlags(doc.documentType), doc)) throw ApiError.forbidden('You cannot change this document');
    assertWritableMachine(doc.machine, today);
    if (body.mode === 'add' && !doc.documentType.allowMultipleFiles) throw ApiError.badRequest(`${doc.documentType.name} takes a single file: use replace`);
    const total = (body.mode === 'add' ? doc.files.length : 0) + body.files.length;
    if (total > MAX_IMAGES_PER_SET) throw ApiError.badRequest(`At most ${MAX_IMAGES_PER_SET} files per document`);
    validateFiles({ ...doc.documentType, allowMultipleFiles: true }, body.files, { machineId: doc.machineId, ownerUserId: doc.ownerUserId });
    if (!doc.documentType.allowMultipleFiles && body.files.length > 1) throw ApiError.badRequest(`${doc.documentType.name} takes a single file`);
    await verifyUploaded(body.files);
    await prisma.$transaction(async (tx) => {
      if (body.mode === 'replace') {
        await tx.machineDocumentFile.deleteMany({ where: { documentId: id } });
        await tx.machineDocumentFile.createMany({ data: fileRows(body.files).map((f) => ({ ...f, documentId: id })) });
      } else {
        const last = doc.files.at(-1)?.sortOrder ?? -1;
        await tx.machineDocumentFile.createMany({ data: fileRows(body.files, last + 1).map((f) => ({ ...f, documentId: id })) });
      }
      await tx.machineDocument.update({ where: { id }, data: { updatedAt: new Date() } });
      await tx.machineDocumentEvent.create({ data: { documentId: id, event: body.mode === 'replace' ? 'FILE_REPLACED' : 'FILE_ADDED', actorId: userId, meta: { added: body.files.length, previous: body.mode === 'replace' ? doc.files.map((f) => f.key) : undefined } } });
    });
    return { id };
  },

  /** Soft delete: the document stays on record with who voided it and why. Admins only. */
  async void(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    const actor = await loadActor(ctx);
    if (!canVoid(actor)) throw ApiError.forbidden('Only an admin can void a document');
    const today = toIstDateString(new Date());
    const doc = await findVisible(ctx, actor, id);
    assertWritableMachine(doc.machine, today);
    await prisma.$transaction([
      prisma.machineDocument.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason.trim() } }),
      prisma.machineDocumentEvent.create({ data: { documentId: id, event: 'VOIDED', actorId: userId, meta: { reason: reason.trim() } } }),
    ]);
    return { id, voided: true };
  },

  // ---- download ------------------------------------------------------------------------------------------------------------------------
  /** A short-lived signed link, after the same scope and role checks as the list. Cost-sensitive and personal downloads are logged. */
  async download(ctx: UserAuthContext, fileId: string, opts: { inline?: boolean }) {
    const actor = await loadActor(ctx);
    const file = await prisma.machineDocumentFile.findUnique({ where: { id: fileId }, select: { id: true, documentId: true, key: true, url: true, originalName: true, sortOrder: true } });
    if (!file) throw ApiError.notFound('File not found');
    const doc = await findVisible(ctx, actor, file.documentId, true);
    const filename = downloadName(doc.documentType.code, doc.machine?.assetCode ?? `OPR-${doc.ownerUserId}`, file.sortOrder, file.originalName);
    if (doc.documentType.costSensitive || doc.documentType.personal) {
      await prisma.machineDocumentEvent.create({ data: { documentId: doc.id, event: 'DOWNLOADED', actorId: ctx.userId, meta: { file: file.originalName } } });
    }
    const url = await signedOrPlain(file.key, file.url, opts.inline ? undefined : filename);
    return { url, filename, originalName: file.originalName, signed: getAwsConfigStatus().configured };
  },

  // ---- export --------------------------------------------------------------------------------------------------------------------------
  /** Register as CSV (opens in Excel). Metadata only, no file links. Hidden document classes are already excluded by the query. */
  async exportCsv(ctx: UserAuthContext, q: RegisterQuery) {
    const actor = await loadActor(ctx);
    const today = toIstDateString(new Date());
    const evs = await loadRegister(ctx, actor, q, today);
    const filtered = q.status ? evs.filter((e) => e.st.status === q.status) : evs;
    const rows = (await Promise.all(filtered.map((e) => toRow(e, actor)))).sort(byUrgency);
    const head = ['Machine', 'Asset code', 'Ownership', 'Document type', 'Title', 'Document no.', 'Issuer', 'Issued', 'Valid till', 'Status', 'Days left', 'Uploaded by', 'Uploaded on'];
    const body = rows.map((r) => [r.machine?.name ?? r.ownerUser?.name ?? '', r.machine?.assetCode ?? '', r.machine?.ownershipType ?? '', r.type.name, r.title, r.documentNumber ?? '', r.issuer ?? '', r.issuedAt ?? '', r.validTill ?? '', r.statusLabel, r.daysLeft ?? '', r.uploadedBy?.name ?? '', r.uploadedAt.slice(0, 10)]);
    return '﻿' + [head, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
  },
};

/** Spreadsheet-safe: quotes when needed and defuses cells that start like a formula. */
function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function guessMime(name: string): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : null;
}

/** A document the caller may see (404 otherwise, so ids from other firms or hidden classes are not disclosed). `includeVoided` for downloads of history. */
async function findVisible(ctx: UserAuthContext, actor: DocActor, id: string, includeVoided = false) {
  const base = await visibleWhere(ctx, actor);
  const where: Prisma.MachineDocumentWhereInput = includeVoided ? { AND: [{ ...base, voidedAt: undefined }, { id }] } : { AND: [base, { id }] };
  const doc = await prisma.machineDocument.findFirst({ where, include });
  if (doc) return doc;
  // a licence may also be seen by the responsible person of a machine the operator is assigned to
  const lic = await prisma.machineDocument.findFirst({ where: { id, voidedAt: includeVoided ? undefined : null, ownerType: 'OPERATOR' }, include });
  if (lic && ctx.userId !== null && (actor.canCost || !lic.documentType.costSensitive)) {
    const ok = await prisma.machineOperatorAssignment.findFirst({
      where: { userId: lic.ownerUserId ?? -1n, ...activeOperatorWhere(), machine: { is: { OR: [{ defaultResponsibleId: ctx.userId }, { assignments: { some: { endedAt: null, responsibleUserId: ctx.userId } } }] } } },
      select: { id: true },
    });
    if (ok) return lic;
  }
  throw ApiError.notFound('Document not found');
}

