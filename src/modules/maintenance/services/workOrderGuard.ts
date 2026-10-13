// Loads a work order for a caller and decides what they may do with it. Every by-id work-order action goes through here.
//
//   visibility   another firm's work order is a 404 (its existence is not disclosed). A site user (role USER) sees only the work
//                orders they are involved in: assigned to them, they are responsible, they raised it, they completed it, they took
//                part in a reassignment, or nobody is assigned or responsible yet.
//   permission   the pure rules in lib/workOrderAccess.ts (assignee works, responsible approves, nobody approves their own work).
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { Decision, WorkOrderFacts, canApprove, canManage, canReassign, canWork } from '../lib/workOrderAccess';

export type WorkOrderAction = 'view' | 'work' | 'approve' | 'reassign' | 'manage';

const INCLUDE = {
  machine: { select: { firmId: true } },
  approvalRequests: { orderBy: { requestedAt: 'desc' as const }, take: 1, select: { status: true, submittedByUserId: true } },
  transfers: { select: { fromUserId: true, toUserId: true } },
} satisfies Prisma.MaintenanceWorkOrderInclude;

export type GuardedWorkOrder = Prisma.MaintenanceWorkOrderGetPayload<{ include: typeof INCLUDE }>;

/** The "is this mine" filter for site users. Used by lists and stats so a count always matches what the user can open. */
export function involvementWhere(me: bigint): Prisma.MaintenanceWorkOrderWhereInput {
  return {
    OR: [
      { currentAssigneeUserId: me },
      { responsibleId: me },
      { requestedById: me },
      { completedByUserId: me },
      { transfers: { some: { OR: [{ fromUserId: me }, { toUserId: me }] } } },
      { AND: [{ currentAssigneeUserId: null }, { responsibleId: null }] },
    ],
  };
}

export function factsOf(wo: GuardedWorkOrder): WorkOrderFacts {
  return {
    assigneeId: wo.currentAssigneeUserId,
    responsibleId: wo.responsibleId,
    requestedById: wo.requestedById,
    submittedById: wo.approvalRequests[0]?.submittedByUserId ?? null,
    completedById: wo.completedByUserId,
  };
}

async function firmVisible(ctx: UserAuthContext, wo: GuardedWorkOrder): Promise<boolean> {
  if (ctx.role === 'SUPER_ADMIN') return true;
  const firmId = wo.firmId ?? wo.machine.firmId;
  if (firmId !== null && ctx.permittedFirms.includes(firmId)) return true;
  // a machine working for a permitted firm (active assignment) is also visible
  const a = await prisma.machineAssignment.findFirst({ where: { machineId: wo.machineId, endedAt: null }, select: { firmId: true } });
  return a !== null && ctx.permittedFirms.includes(a.firmId);
}

function involved(ctx: UserAuthContext, wo: GuardedWorkOrder): boolean {
  if (ctx.role !== 'USER') return true;
  const me = ctx.userId;
  if (me === null) return false;
  if (wo.currentAssigneeUserId === null && wo.responsibleId === null) return true;
  return (
    wo.currentAssigneeUserId === me || wo.responsibleId === me || wo.requestedById === me || wo.completedByUserId === me ||
    wo.transfers.some((t) => t.fromUserId === me || t.toUserId === me)
  );
}

export async function loadVisibleWorkOrder(ctx: UserAuthContext, id: string): Promise<GuardedWorkOrder> {
  if (ctx.userId === null) throw ApiError.unauthorized('Login required');
  const wo = await prisma.maintenanceWorkOrder.findUnique({ where: { id }, include: INCLUDE });
  if (!wo || !(await firmVisible(ctx, wo)) || !involved(ctx, wo)) throw ApiError.notFound('Work order not found');
  return wo;
}

const RULES: Record<Exclude<WorkOrderAction, 'view'>, (a: { userId: bigint | null; role: string }, f: WorkOrderFacts) => Decision> = {
  work: canWork,
  approve: canApprove,
  reassign: canReassign,
  manage: canManage,
};

/** Loads the work order (404 if the caller cannot see it) and throws 403 with the reason when the action is not allowed. */
export async function authorize(ctx: UserAuthContext, id: string, action: WorkOrderAction): Promise<GuardedWorkOrder> {
  const wo = await loadVisibleWorkOrder(ctx, id);
  if (action === 'view') return wo;
  const decision = RULES[action]({ userId: ctx.userId, role: ctx.role }, factsOf(wo));
  if (!decision.ok) throw ApiError.forbidden(decision.reason);
  return wo;
}
