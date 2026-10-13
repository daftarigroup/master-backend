import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// Rollups on Machine/Asset (repairCount, totalRepairCost, maintenanceCount, status back to ACTIVE...) used to be applied
// by two modules independently: Maintenance when an out-source repair was marked completed, and Repair when its payment
// was settled, so one job was counted twice and the machine was marked OPERATIONAL while still at the vendor.
//
// Now there is ONE guard per work order: `MaintenanceWorkOrder.rollupAppliedAt`. Claiming it is a single atomic
// UPDATE ... WHERE rollupAppliedAt IS NULL, so concurrent or repeated callers can never apply a rollup twice.

/** true if this caller won the claim (and therefore must apply the rollup). */
export async function claimRollup(tx: Tx, workOrderId: string): Promise<boolean> {
  const res = await tx.maintenanceWorkOrder.updateMany({
    where: { id: workOrderId, rollupAppliedAt: null },
    data: { rollupAppliedAt: new Date() },
  });
  return res.count === 1;
}

/**
 * A repair/breakdown job is finished and the machine is back: bump the repair history and restore the machine.
 * No-op (returns false) when this work order has already been rolled up.
 */
export async function applyRepairRollupOnce(
  tx: Tx,
  wo: { id: string; machineId: string },
  amount: number,
  partsChanged: boolean,
): Promise<boolean> {
  if (!(await claimRollup(tx, wo.id))) return false;
  const machine = await tx.machine.findUnique({ where: { id: wo.machineId }, select: { assetId: true } });
  // The machine comes back into service even when it has no linked Asset (it used to be skipped).
  await tx.machine.update({ where: { id: wo.machineId }, data: { status: 'OPERATIONAL', statusChangedAt: new Date() } });
  if (machine?.assetId) {
    await tx.asset.update({
      where: { id: machine.assetId },
      data: {
        status: 'ACTIVE',
        repairCount: { increment: 1 },
        lastRepairDate: new Date(),
        lastRepairCost: amount,
        totalRepairCost: { increment: amount },
        partsChanged: partsChanged || undefined,
      },
    });
  }
  return true;
}

/** A routine maintenance task is approved as done: bump the maintenance history, once. */
export async function applyMaintenanceRollupOnce(tx: Tx, wo: { id: string; machineId: string }): Promise<boolean> {
  if (!(await claimRollup(tx, wo.id))) return false;
  const machine = await tx.machine.findUnique({ where: { id: wo.machineId }, select: { assetId: true } });
  if (machine?.assetId) {
    await tx.asset.update({
      where: { id: machine.assetId },
      data: { maintenanceCount: { increment: 1 }, lastMaintenanceDate: new Date() },
    });
  }
  return true;
}

/**
 * The bill that was rolled up turned out different when it was actually paid (discount, deduction). Correct the
 * asset's running total by the difference instead of adding the job a second time.
 */
export async function adjustRolledUpCost(tx: Tx, machineId: string, rolledUp: number, finalAmount: number): Promise<void> {
  const delta = Math.round((finalAmount - rolledUp) * 100) / 100;
  if (delta === 0) return;
  const machine = await tx.machine.findUnique({ where: { id: machineId }, select: { assetId: true } });
  if (!machine?.assetId) return;
  await tx.asset.update({
    where: { id: machine.assetId },
    data: { totalRepairCost: { increment: delta }, lastRepairCost: finalAmount },
  });
}
