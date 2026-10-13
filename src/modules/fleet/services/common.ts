import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { FirmScope, assertFirmWritable, firmWhere, resolveFirmScope } from '../../../utils/firmScope';
import { fleetConfig } from '../config';
import { machineAccessWhere } from '../lib/machineAccess';

export type Db = Prisma.TransactionClient | typeof prisma;

export interface Warning {
  code: string;
  message: string;
}

export function requireUserId(ctx: UserAuthContext): bigint {
  if (ctx.userId === null) throw ApiError.unauthorized('Login required');
  return ctx.userId;
}

export function assertNotFarFuture(d: Date, label: string) {
  if (d.getTime() > Date.now() + fleetConfig.maxFutureMs) {
    throw ApiError.badRequest(`${label} is in the future`);
  }
}

/**
 * Loads a machine the caller is allowed to read, or throws 404 (never 403, so ids of machines in other firms are not
 * disclosed). Visible when the owning firm or the active assignment's firm is permitted (see lib/machineAccess.ts); a site user
 * who is not an operator of a machine that has operators assigned does not see it. Machines with no firm are visible to
 * SUPER_ADMIN only.
 */
export async function loadMachineInScope(db: Db, ctx: UserAuthContext, machineId: string) {
  const machine = await db.machine.findFirst({ where: { AND: [{ id: machineId }, await machineAccessWhere(ctx)] } });
  if (!machine) throw ApiError.notFound('Machine not found');
  return machine;
}

/** The machine's ACTIVE assignment (where it is working today), if any. */
export async function activeAssignmentOf(db: Db, machineId: string) {
  return db.machineAssignment.findFirst({ where: { machineId, endedAt: null } });
}

/**
 * The firm (project) a log, diesel issue or cost entry for this machine is booked to: the firm of its active assignment, else the
 * owning firm. History keeps the firm it was stamped with, so a transfer moves only FUTURE rows. An explicit firm in the request
 * that is neither the working firm nor the owning firm is a 400. The caller must be allowed to write to the result.
 */
export async function resolveMachineWriteFirm(db: Db, ctx: UserAuthContext, machine: { id: string; firmId: bigint | null }, requested: bigint | null): Promise<bigint> {
  const assignment = await activeAssignmentOf(db, machine.id);
  const working = assignment?.firmId ?? machine.firmId;
  if (requested !== null && working !== null && requested !== working && requested !== machine.firmId) {
    throw ApiError.badRequest('This machine is working for a different firm');
  }
  const firmId = working ?? requested;
  if (firmId === null) throw ApiError.badRequest('firmId is required for a machine that has no firm');
  assertFirmWritable(ctx, firmId);
  return firmId;
}

/**
 * The firm a fleet row is written under. A machine's own firm wins; an explicit firm that
 * disagrees with the machine's is a 400. A firm-less machine needs an explicit firm.
 * The caller must be allowed to write to the result.
 */
export function resolveWriteFirm(ctx: UserAuthContext, requested: bigint | null, machineFirm: bigint | null): bigint {
  if (requested !== null && machineFirm !== null && requested !== machineFirm) {
    throw ApiError.badRequest('This machine belongs to a different firm');
  }
  const firmId = machineFirm ?? requested;
  if (firmId === null) throw ApiError.badRequest('firmId is required for a machine that has no firm');
  assertFirmWritable(ctx, firmId);
  return firmId;
}

export function scopeOf(ctx: UserAuthContext, requestedFirm?: unknown): FirmScope {
  return resolveFirmScope(ctx, requestedFirm);
}

export function isUniqueViolation(e: unknown, target?: string): boolean {
  const err = e as { code?: string; meta?: { target?: unknown }; message?: string };
  if (err?.code !== 'P2002') return false;
  if (!target) return true;
  return JSON.stringify(err.meta ?? {}).includes(target) || (err.message ?? '').includes(target);
}

export function pageOf(query: { limit?: number; offset?: number }) {
  return { take: Math.min(Math.max(query.limit ?? 50, 1), 1000), skip: Math.max(query.offset ?? 0, 0) };
}

export const num = (v: Prisma.Decimal | number | string | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
