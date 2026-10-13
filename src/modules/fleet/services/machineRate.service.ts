import { MachineRateType, RateBasis } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable } from '../../../utils/firmScope';
import { addDays } from '../cost/period';
import { isUniqueViolation, loadMachineInScope, requireUserId } from './common';

export interface CreateRateBody {
  rateType: MachineRateType;
  basis: RateBasis;
  amount: number;
  minBillableQty?: number | null;
  extraRate?: number | null;
  deductBreakdownDays?: boolean;
  effectiveFrom: string; // IST day
  note?: string | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The rate card is append-only. A change adds a row with a LATER effectiveFrom and closes the previous row the day before, so
 * history is never rewritten: a past month always reproduces with the rate that was in force then.
 */
export const machineRateService = {
  async create(ctx: UserAuthContext, machineId: string, body: CreateRateBody) {
    const userId = requireUserId(ctx);
    const machine = await loadMachineInScope(prisma, ctx, machineId);
    if (machine.firmId === null) throw ApiError.badRequest('This machine has no firm; set its firm before adding rates');
    assertFirmWritable(ctx, machine.firmId);
    if (body.rateType === 'RENTAL' && machine.ownershipType !== 'RENTED') throw ApiError.badRequest('A rental rate only applies to a rented machine');
    if (body.rateType === 'INTERNAL_HOURLY' && body.basis !== 'HOUR' && body.basis !== 'KM') throw ApiError.badRequest('An internal charge-out rate is per hour or per km');
    if ((body.extraRate != null || body.minBillableQty != null) && (body.basis === 'MONTH' || body.rateType === 'INTERNAL_HOURLY')) {
      throw ApiError.badRequest('Minimum quantity and extra rate apply to hourly, daily and per-km rental rates only');
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const latest = await tx.machineRate.findFirst({ where: { machineId, rateType: body.rateType }, orderBy: { effectiveFrom: 'desc' } });
        if (latest && body.effectiveFrom <= day(latest.effectiveFrom)) {
          throw ApiError.conflict(`A rate already starts on ${day(latest.effectiveFrom)}. Add the new rate from a later date: rate history is never rewritten.`);
        }
        if (latest && (latest.effectiveTo === null || day(latest.effectiveTo) >= body.effectiveFrom)) {
          await tx.machineRate.update({ where: { id: latest.id }, data: { effectiveTo: new Date(addDays(body.effectiveFrom, -1)) } });
        }
        const row = await tx.machineRate.create({
          data: {
            firmId: machine.firmId!,
            machineId,
            rateType: body.rateType,
            basis: body.basis,
            amount: body.amount,
            minBillableQty: body.minBillableQty ?? null,
            extraRate: body.extraRate ?? null,
            deductBreakdownDays: Boolean(body.deductBreakdownDays),
            effectiveFrom: new Date(body.effectiveFrom),
            note: body.note?.trim() || null,
            createdById: userId,
          },
        });
        return { id: row.id, effectiveFrom: body.effectiveFrom };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw ApiError.conflict('A rate already starts on that date');
      throw e;
    }
  },

  /** Ends an open rate on a date (hire released, rate withdrawn). The only update a rate row ever gets, besides being closed by a successor. */
  async end(ctx: UserAuthContext, machineId: string, rateId: string, endDate: string) {
    const machine = await loadMachineInScope(prisma, ctx, machineId);
    if (machine.firmId !== null) assertFirmWritable(ctx, machine.firmId);
    const rate = await prisma.machineRate.findFirst({ where: { id: rateId, machineId } });
    if (!rate) throw ApiError.notFound('Rate not found');
    if (rate.effectiveTo !== null) throw ApiError.conflict('This rate already has an end date');
    if (endDate < day(rate.effectiveFrom)) throw ApiError.badRequest('The end date is before the rate starts');
    await prisma.machineRate.update({ where: { id: rateId }, data: { effectiveTo: new Date(endDate) } });
    return { id: rateId, effectiveTo: endDate };
  },
};
