import { Prisma } from '@prisma/client';

/** actual parts cost of a work order = the Store value of the parts issued so far (null when nothing is issued). */
export async function refreshPartsCost(tx: Prisma.TransactionClient, workOrderId: string): Promise<void> {
  const agg = await tx.workOrderPartIssue.aggregate({ where: { workOrderId, voidedAt: null }, _sum: { amount: true }, _count: true });
  await tx.maintenanceWorkOrder.update({ where: { id: workOrderId }, data: { actualPartsCost: agg._count > 0 ? agg._sum.amount ?? 0 : null } });
}
