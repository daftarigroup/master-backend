// Which machines a caller may see and work on.
//
//   1. Firm: the machine's owning firm OR its ACTIVE assignment's firm must be permitted. The assignment case is read live from
//      the database: `permittedFirms` in the JWT is frozen at login, but a transfer changes where a machine works today.
//   2. Operator scope: an ordinary site user (role USER without the `asset_all` page) sees a machine that has operators
//      assigned only when they are one of them, the machine's responsible person, or its default mechanic / responsible.
//      A machine with NO active operator assignment stays visible to everyone in the firm, so switching this on does not
//      hide the whole fleet from site users before any operator has been assigned.
import { Prisma } from '@prisma/client';
import { hasPageAccessKey } from '../../../middleware/requireCostAccess';
import { UserAuthContext } from '../../../utils/currentUser';
import { NO_FIRM, resolveFirmScope } from '../../../utils/firmScope';
import { toIstDateString } from './istDate';

export const ASSET_ALL_KEYS = ['asset_all', 'assetAll'];
export const WORK_LOG_APPROVE_KEYS = ['asset_work_log_approve', 'assetWorkLogApprove'];

/** An operator assignment that is in force today (not ended, not past its valid-till date). */
export function activeOperatorWhere(today = toIstDateString(new Date())): Prisma.MachineOperatorAssignmentWhereInput {
  return { endedAt: null, OR: [{ validTill: null }, { validTill: { gte: new Date(today) } }] };
}

/** True for a site user who only sees the machines they operate or are responsible for. */
export async function isOperatorScoped(ctx: UserAuthContext): Promise<boolean> {
  if (ctx.role !== 'USER') return false;
  return !(await hasPageAccessKey(ctx, ASSET_ALL_KEYS));
}

export async function machineAccessWhere(ctx: UserAuthContext, requestedFirm?: unknown): Promise<Prisma.MachineWhereInput> {
  const scope = resolveFirmScope(ctx, requestedFirm);
  const firmPart: Prisma.MachineWhereInput = scope.all
    ? {}
    : {
        OR: [
          {
            firmId: { in: scope.firmIds },
            assignments: { none: { endedAt: null, firmId: { notIn: scope.firmIds } } },
          },
          { assignments: { some: { endedAt: null, firmId: { in: scope.firmIds } } } },
        ],
      };

  if (!(await isOperatorScoped(ctx))) return firmPart;
  if (ctx.userId === null) return { firmId: NO_FIRM };

  const me = ctx.userId;
  const operatorPart: Prisma.MachineWhereInput = {
    OR: [
      { operatorAssignments: { none: activeOperatorWhere() } },
      { operatorAssignments: { some: { ...activeOperatorWhere(), userId: me } } },
      { assignments: { some: { endedAt: null, responsibleUserId: me } } },
      { defaultResponsibleId: me },
      { defaultMechanicId: me },
    ],
  };
  return { AND: [firmPart, operatorPart] };
}
