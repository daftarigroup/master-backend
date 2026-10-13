// Site transfers: moving a machine from one project to another. REQUESTED -> (APPROVED, optional) -> IN_TRANSIT -> RECEIVED, or
// CANCELLED before dispatch. Receiving closes the old assignment and opens the new one, so from that moment new work logs, diesel and
// cost entries are booked to the destination project; everything already logged keeps the project it was stamped with.
// Both the source and the destination firm can see an open transfer; only the destination can receive it.
import { Prisma, TransferStatus } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, resolveFirmScope } from '../../../utils/firmScope';
import { isAdminRole } from '../../../middleware/requireCostAccess';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { toIstDateString } from '../lib/istDate';
import { loadMachineInScope, pageOf, requireUserId } from './common';

const OPEN: TransferStatus[] = ['REQUESTED', 'APPROVED', 'IN_TRANSIT'];
const name = (u: { name: string | null; user_name: string | null } | null | undefined) => (u ? u.name || u.user_name || null : null);

const INCLUDE = {
  machine: { select: { id: true, name: true, assetCode: true, imageUrl: true, ownershipType: true, rentalEndAt: true } },
  fromFirm: { select: { id: true, firm_name: true } },
  toFirm: { select: { id: true, firm_name: true } },
  requestedBy: { select: { name: true, user_name: true } },
  events: { orderBy: { createdAt: 'asc' as const }, include: { actor: { select: { name: true, user_name: true } } } },
} satisfies Prisma.MachineTransferInclude;
type Row = Prisma.MachineTransferGetPayload<{ include: typeof INCLUDE }>;

async function siteNames(ids: Array<bigint | null>) {
  const real = ids.filter((i): i is bigint => i !== null);
  const rows = real.length === 0 ? [] : await prisma.siteLocationDetails.findMany({ where: { id: { in: real } }, select: { id: true, location: true } });
  return new Map(rows.map((r) => [String(r.id), r.location]));
}

async function map(rows: Row[]) {
  const sites = await siteNames(rows.flatMap((r) => [r.fromSiteLocationId, r.toSiteLocationId]));
  return rows.map((r) => ({
    id: r.id,
    transferNumber: r.transferNumber,
    status: r.status,
    machine: { id: r.machine.id, name: r.machine.name, assetCode: r.machine.assetCode, imageUrl: r.machine.imageUrl },
    from: { firm: { id: String(r.fromFirm.id), name: r.fromFirm.firm_name }, site: r.fromSiteLocationId ? (sites.get(String(r.fromSiteLocationId)) ?? null) : null },
    to: { firm: { id: String(r.toFirm.id), name: r.toFirm.firm_name }, site: r.toSiteLocationId ? (sites.get(String(r.toSiteLocationId)) ?? null) : null },
    requestedBy: name(r.requestedBy),
    requestedAt: r.requestedAt.toISOString(),
    dispatchedAt: r.dispatchedAt?.toISOString() ?? null,
    transporter: r.transporter,
    vehicleNo: r.vehicleNo,
    lrRef: r.lrRef,
    eta: r.eta ? r.eta.toISOString().slice(0, 10) : null,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    note: r.note,
    events: r.events.map((e) => ({ from: e.fromStatus, to: e.toStatus, note: e.note, at: e.createdAt.toISOString(), by: name(e.actor) })),
  }));
}

async function event(tx: Prisma.TransactionClient, transferId: string, from: TransferStatus | null, to: TransferStatus, actorId: bigint, note?: string | null) {
  await tx.machineTransferEvent.create({ data: { transferId, fromStatus: from, toStatus: to, actorId, note: note ?? null } });
}

/** A transfer is visible to the source and the destination firm. */
async function load(ctx: UserAuthContext, id: string): Promise<Row> {
  const scope = resolveFirmScope(ctx, undefined);
  const row = await prisma.machineTransfer.findFirst({
    where: { id, ...(scope.all ? {} : { OR: [{ fromFirmId: { in: scope.firmIds } }, { toFirmId: { in: scope.firmIds } }] }) },
    include: INCLUDE,
  });
  if (!row) throw ApiError.notFound('Transfer not found');
  return row;
}

/** Admins, or the responsible person of the machine's current assignment, may move a machine on. */
async function assertMayMove(ctx: UserAuthContext, machineId: string) {
  if (isAdminRole(ctx.role)) return;
  const a = await prisma.machineAssignment.findFirst({ where: { machineId, endedAt: null }, select: { responsibleUserId: true } });
  if (!a || a.responsibleUserId === null || a.responsibleUserId !== ctx.userId) throw ApiError.forbidden('Only an admin or the machine\'s responsible person can do this');
}

export const transferService = {
  async list(ctx: UserAuthContext, q: { firmId?: unknown; status?: TransferStatus | 'OPEN'; machineId?: string; limit?: number; offset?: number }) {
    const scope = resolveFirmScope(ctx, q.firmId);
    const where: Prisma.MachineTransferWhereInput = {
      ...(scope.all ? {} : { OR: [{ fromFirmId: { in: scope.firmIds } }, { toFirmId: { in: scope.firmIds } }] }),
      ...(q.machineId ? { machineId: q.machineId } : {}),
      ...(q.status === 'OPEN' || q.status === undefined ? { status: { in: OPEN } } : { status: q.status }),
    };
    const { take, skip } = pageOf({ limit: q.limit ?? 50, offset: q.offset });
    const [rows, total] = await Promise.all([
      prisma.machineTransfer.findMany({ where, include: INCLUDE, orderBy: { requestedAt: 'desc' }, take, skip }),
      prisma.machineTransfer.count({ where }),
    ]);
    return { total, rows: await map(rows) };
  },

  async request(ctx: UserAuthContext, body: { machineId: string; toFirmId: bigint; toSiteLocationId?: bigint | null; eta?: string | null; note?: string | null }) {
    const userId = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, body.machineId);
    await assertMayMove(ctx, machine.id);
    const assignment = await prisma.machineAssignment.findFirst({ where: { machineId: machine.id, endedAt: null } });
    if (!assignment) throw ApiError.badRequest('This machine is not assigned to a project, so there is nothing to transfer. Assign it instead.');
    const toFirm = await prisma.firm.findUnique({ where: { id: body.toFirmId }, select: { id: true } });
    if (!toFirm) throw ApiError.badRequest('Unknown destination firm');
    if (body.toSiteLocationId) {
      const site = await prisma.siteLocationDetails.findFirst({ where: { id: body.toSiteLocationId, firm_id: body.toFirmId }, select: { id: true } });
      if (!site) throw ApiError.badRequest('That site does not belong to the destination firm');
    }
    if (body.toFirmId === assignment.firmId && (body.toSiteLocationId ?? null) === assignment.siteLocationId) {
      throw ApiError.badRequest('The destination is where the machine already is');
    }
    try {
      const id = await prisma.$transaction(async (tx) => {
        const transferNumber = await documentSequenceService.next({ firmId: assignment.firmId, prefix: 'TRF', year: Number(toIstDateString(new Date()).slice(0, 4)), pad: 5 }, tx);
        const t = await tx.machineTransfer.create({
          data: {
            transferNumber,
            machineId: machine.id,
            fromAssignmentId: assignment.id,
            fromFirmId: assignment.firmId,
            fromSiteLocationId: assignment.siteLocationId,
            toFirmId: body.toFirmId,
            toSiteLocationId: body.toSiteLocationId ?? null,
            eta: body.eta ? new Date(body.eta) : null,
            note: body.note?.trim() || null,
            requestedById: userId,
          },
        });
        await event(tx, t.id, null, 'REQUESTED', userId, body.note);
        return t.id;
      });
      return (await map([await load(ctx, id)]))[0];
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') throw ApiError.conflict('This machine already has an open transfer');
      throw e;
    }
  },

  /** Optional step: a firm that wants sign-off before the machine leaves can require it (the UI offers it, the API allows skipping it). */
  async approve(ctx: UserAuthContext, id: string) {
    const userId = requireUserId(ctx);
    if (!isAdminRole(ctx.role)) throw ApiError.forbidden('Only an admin can approve a transfer');
    const t = await load(ctx, id);
    assertFirmWritable(ctx, t.fromFirmId);
    if (t.status !== 'REQUESTED') throw ApiError.conflict(`This transfer is ${t.status}; only a requested transfer can be approved`);
    await prisma.$transaction(async (tx) => {
      await tx.machineTransfer.update({ where: { id }, data: { status: 'APPROVED', approvedById: userId } });
      await event(tx, id, 'REQUESTED', 'APPROVED', userId);
    });
    return (await map([await load(ctx, id)]))[0];
  },

  async dispatch(ctx: UserAuthContext, id: string, body: { transporter?: string | null; vehicleNo?: string | null; lrRef?: string | null; eta?: string | null }) {
    const userId = requireUserId(ctx);
    const t = await load(ctx, id);
    assertFirmWritable(ctx, t.fromFirmId);
    await assertMayMove(ctx, t.machineId);
    if (t.status !== 'REQUESTED' && t.status !== 'APPROVED') throw ApiError.conflict(`This transfer is ${t.status}; it cannot be dispatched`);
    await prisma.$transaction(async (tx) => {
      await tx.machineTransfer.update({
        where: { id },
        data: {
          status: 'IN_TRANSIT',
          dispatchedAt: new Date(),
          transporter: body.transporter?.trim() || null,
          vehicleNo: body.vehicleNo?.trim() || null,
          lrRef: body.lrRef?.trim() || null,
          ...(body.eta ? { eta: new Date(body.eta) } : {}),
        },
      });
      await event(tx, id, t.status, 'IN_TRANSIT', userId, [body.transporter, body.vehicleNo, body.lrRef].filter(Boolean).join(' / ') || null);
    });
    return (await map([await load(ctx, id)]))[0];
  },

  /** Destination only. Closes the old assignment, opens the new one (project, site, responsible person, return-by). */
  async receive(ctx: UserAuthContext, id: string, body: { responsibleUserId?: bigint | null; expectedReturnAt?: string | null; note?: string | null }) {
    const userId = requireUserId(ctx);
    const t = await load(ctx, id);
    assertFirmWritable(ctx, t.toFirmId); // only a user of the destination firm can receive
    if (t.status !== 'IN_TRANSIT') throw ApiError.conflict(`This transfer is ${t.status}; only a dispatched transfer can be received`);
    const machine = await prisma.machine.findUniqueOrThrow({ where: { id: t.machineId } });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.machineAssignment.updateMany({ where: { machineId: t.machineId, endedAt: null }, data: { endedAt: now, endReason: 'TRANSFER' } });
      await tx.machineAssignment.create({
        data: {
          machineId: t.machineId,
          firmId: t.toFirmId,
          siteLocationId: t.toSiteLocationId,
          startedAt: now,
          expectedReturnAt: body.expectedReturnAt ? new Date(body.expectedReturnAt) : machine.ownershipType === 'RENTED' && machine.rentalEndAt ? machine.rentalEndAt : null,
          responsibleUserId: body.responsibleUserId ?? machine.defaultResponsibleId ?? null,
          createdById: userId,
        },
      });
      await tx.machine.update({ where: { id: t.machineId }, data: { siteLocationId: t.toSiteLocationId } });
      await tx.machineTransfer.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: now, receivedById: userId } });
      await event(tx, id, 'IN_TRANSIT', 'RECEIVED', userId, body.note);
    });
    return (await map([await load(ctx, id)]))[0];
  },

  async cancel(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    if (reason.trim().length < 3) throw ApiError.badRequest('Give a reason for cancelling (at least 3 characters)');
    const t = await load(ctx, id);
    assertFirmWritable(ctx, t.fromFirmId);
    if (!(isAdminRole(ctx.role) || t.requestedById === userId)) throw ApiError.forbidden('Only an admin or the person who requested the transfer can cancel it');
    if (t.status !== 'REQUESTED' && t.status !== 'APPROVED') throw ApiError.conflict(`This transfer is ${t.status}; it can only be cancelled before it is dispatched`);
    await prisma.$transaction(async (tx) => {
      await tx.machineTransfer.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason.trim() } });
      await event(tx, id, t.status, 'CANCELLED', userId, reason.trim());
    });
    return (await map([await load(ctx, id)]))[0];
  },
};
