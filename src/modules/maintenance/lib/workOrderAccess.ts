// Who may do what to a work order. Pure rules: the service loads the facts, these functions decide. Enforced on the server for every
// work-order action; the UI only mirrors it.
//
//   assignee      does the work: progress, checklist, parts, documents, mark done
//   responsible   accountable: approves / rejects the completion, may reassign
//   admin         ADMIN / SUPER_ADMIN: everything
//   Nobody approves their own work. If the assignee is also the responsible person (or the responsible person is the one who
//   submitted it), approval goes to an admin. A work order with no responsible person (every order created before this rule)
//   is approved by an admin.

export interface WorkOrderFacts {
  assigneeId: bigint | null;
  responsibleId: bigint | null;
  requestedById: bigint | null;
  /** who marked it done (the pending approval request's submitter) */
  submittedById: bigint | null;
  completedById: bigint | null;
}

export interface Actor {
  userId: bigint | null;
  role: string;
}

export type Decision = { ok: true } | { ok: false; reason: string };
const yes: Decision = { ok: true };
const no = (reason: string): Decision => ({ ok: false, reason });

export const isSuperAdmin = (a: Actor) => a.role === 'SUPER_ADMIN';
export const isAdmin = (a: Actor) => a.role === 'ADMIN' || a.role === 'SUPER_ADMIN';
const same = (a: bigint | null, b: bigint | null) => a !== null && b !== null && a === b;

/** The people whose work this is: whoever did it, whoever it was assigned to, and whoever marked it done. */
function authors(f: WorkOrderFacts): bigint[] {
  return [f.submittedById, f.completedById].filter((x): x is bigint => x !== null);
}

export function canApprove(actor: Actor, f: WorkOrderFacts): Decision {
  if (actor.userId === null) return no('Login required');
  // SUPER_ADMIN has full access to all data and all approval stages
  if (isSuperAdmin(actor)) return yes;
  if (authors(f).some((id) => id === actor.userId)) return no('You cannot approve work you submitted yourself');
  if (isAdmin(actor)) return yes;
  if (f.responsibleId === null) return no('This work order has no responsible person: an admin must approve it');
  // the responsible person approves unless they are also the assignee or the submitter (then an admin does)
  if (same(f.responsibleId, f.assigneeId) || authors(f).some((id) => id === f.responsibleId)) {
    return no('The assignee is also the responsible person: an admin must approve this work order');
  }
  return same(actor.userId, f.responsibleId) ? yes : no('Only the responsible person or an admin can approve this work order');
}

/** Progress, checklist, parts, documents, mark done. An unassigned order can be worked by any logged-in user in the firm. */
export function canWork(actor: Actor, f: WorkOrderFacts): Decision {
  if (actor.userId === null) return no('Login required');
  if (isAdmin(actor)) return yes;
  if (f.assigneeId === null && f.responsibleId === null) return yes;
  if (same(actor.userId, f.assigneeId) || same(actor.userId, f.responsibleId)) return yes;
  return no('Only the assigned person, the responsible person or an admin can update this work order');
}

export function canReassign(actor: Actor, f: WorkOrderFacts): Decision {
  if (actor.userId === null) return no('Login required');
  if (isAdmin(actor)) return yes;
  if (f.responsibleId !== null && same(actor.userId, f.responsibleId)) return yes;
  // an order that nobody is accountable for can be passed on by whoever holds it
  if (f.responsibleId === null && same(actor.userId, f.assigneeId)) return yes;
  return no('Only the responsible person or an admin can reassign this work order');
}

/** Cancel / skip / hold. The requester can withdraw what they raised. */
export function canManage(actor: Actor, f: WorkOrderFacts): Decision {
  if (actor.userId === null) return no('Login required');
  if (isAdmin(actor)) return yes;
  if (same(actor.userId, f.responsibleId) || same(actor.userId, f.requestedById)) return yes;
  if (f.assigneeId === null && f.responsibleId === null) return yes;
  return no('Only the responsible person, the requester or an admin can do this');
}

export const TERMINAL_STATUSES = ['COMPLETED', 'COMPLETED_LATE', 'CANCELLED', 'SKIPPED', 'MISSED'] as const;
export const isOpenStatus = (status: string) => !(TERMINAL_STATUSES as readonly string[]).includes(status);

export interface ChecklistItemFacts {
  state: 'PENDING' | 'DONE' | 'ISSUE';
}
/** done / total from the items themselves (ISSUE and PENDING do not count); never stored. */
export function checklistProgress(items: ChecklistItemFacts[]) {
  const total = items.length;
  const done = items.filter((i) => i.state === 'DONE').length;
  const issues = items.filter((i) => i.state === 'ISSUE').length;
  return { total, done, issues, pending: total - done - issues, percent: total === 0 ? null : Math.round((done / total) * 100) };
}
