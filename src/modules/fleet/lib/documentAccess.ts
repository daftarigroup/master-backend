// Who may see and change machine documents. The rules are pure so they can be tested without a database; the service loads the facts.
//
//   View    non-sensitive documents: anyone who can see the machine (operators included on their assigned machines).
//           cost-sensitive types (purchase invoice, rental agreement / invoice, vendor bill) and the amount: cost-permitted roles only.
//           personal documents (operator licence): admins, the operator themself, and the responsible person of the machine.
//   Upload  editors (admin, or page access asset_all / asset_documents): any type. Everyone else with machine access: Service
//           documents and photos that are not cost-sensitive, on machines they operate, are responsible for, or have a task on.
//   Edit    editors; other users only their own non-sensitive Service documents.
//   Void    admins only.
import { canViewCost, hasPageAccessKey, isAdminRole } from '../../../middleware/requireCostAccess';
import { UserAuthContext } from '../../../utils/currentUser';
import { ASSET_ALL_KEYS } from './machineAccess';

export const DOCUMENT_PAGE_KEYS = ['asset_documents', 'assetDocuments'];

export interface DocActor {
  userId: bigint | null;
  admin: boolean;
  editor: boolean;
  canCost: boolean;
}

export async function loadActor(ctx: UserAuthContext): Promise<DocActor> {
  const admin = isAdminRole(ctx.role);
  const [editor, canCost] = await Promise.all([
    admin ? Promise.resolve(true) : hasPageAccessKey(ctx, [...DOCUMENT_PAGE_KEYS, ...ASSET_ALL_KEYS]),
    canViewCost(ctx),
  ]);
  return { userId: ctx.userId, admin, editor, canCost };
}

export interface TypeFlags {
  category: string;
  costSensitive: boolean;
  personal: boolean;
}

/** Cost-sensitive types are invisible without cost access: lists, counts, search, export, drawer. Personal ones need `personalOk`. */
export function canSeeType(actor: DocActor, t: TypeFlags, personalOk = false): boolean {
  if (t.costSensitive && !actor.canCost) return false;
  if (t.personal && !(actor.admin || personalOk)) return false;
  return true;
}

export interface Relation {
  /** Active operator of the machine, its responsible person, default mechanic, or assignee of an open task on it. */
  worksOnMachine: boolean;
}

export function canUpload(actor: DocActor, t: TypeFlags, rel: Relation): boolean {
  if (actor.userId === null) return false;
  if (t.costSensitive && !actor.canCost) return false;
  if (actor.editor) return true;
  return t.category === 'SERVICE' && !t.costSensitive && !t.personal && rel.worksOnMachine;
}

export function canEdit(actor: DocActor, t: TypeFlags, doc: { createdById: bigint | null }): boolean {
  if (t.costSensitive && !actor.canCost) return false;
  if (actor.editor) return true;
  return actor.userId !== null && doc.createdById === actor.userId && t.category === 'SERVICE' && !t.costSensitive && !t.personal;
}

export const canVoid = (actor: DocActor): boolean => actor.admin;
