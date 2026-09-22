import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { dateToISODate, decimalToNumber } from './mapUtils';

const INCLUDE = { machine: { select: { id: true, name: true, serialNumber: true } }, vendor: true } as const;

function status(endDate: Date): 'Active' | 'Expiring Soon' | 'Expired' {
  const days = Math.floor((endDate.getTime() - Date.now()) / 86400000);
  if (days < 0) return 'Expired';
  if (days <= 60) return 'Expiring Soon';
  return 'Active';
}

// Matches mockRepairStore.ts#AMCItem exactly.
function toDTO(row: any) {
  return {
    id: row.id,
    contractNumber: row.contractNumber ?? '',
    machineName: row.machine?.name ?? '',
    serialNumber: row.machine?.serialNumber ?? '',
    vendorName: row.vendor?.name ?? '',
    vendorContact: row.vendor?.mobileNumber ?? '',
    startDate: dateToISODate(row.startDate),
    endDate: dateToISODate(row.endDate),
    annualCost: decimalToNumber(row.annualCost),
    visitsPerYear: row.visitsPerYear,
    completedVisits: row.completedVisits,
    status: status(row.endDate),
    scope: row.scope ?? '',
  };
}

export const amcService = {
  async list() {
    const rows = await prisma.aMCContract.findMany({ include: INCLUDE, orderBy: { startDate: 'desc' } });
    return rows.map(toDTO);
  },

  async create(data: { machineId?: string; vendorId?: string; vendorName?: string; startDate?: string; endDate?: string; annualCost?: number; visitsPerYear?: number; scope?: string }) {
    return prisma.$transaction(async (tx) => {
      const contractNumber = await documentSequenceService.next({ prefix: 'AMC', year: new Date().getFullYear(), pad: 3 }, tx);

      let vendorId = data.vendorId ?? null;
      if (!vendorId && data.vendorName) {
        const vendor = await tx.repairVendor.findFirst({ where: { name: data.vendorName } });
        vendorId = vendor?.id ?? null;
      }

      if (!data.machineId) throw ApiError.badRequest('machineId is required');

      const row = await tx.aMCContract.create({
        data: {
          contractNumber,
          machine: { connect: { id: data.machineId } },
          ...(vendorId ? { vendor: { connect: { id: vendorId } } } : {}),
          startDate: data.startDate ? new Date(data.startDate) : new Date(),
          endDate: data.endDate ? new Date(data.endDate) : new Date(Date.now() + 365 * 86400000),
          annualCost: data.annualCost ?? 0,
          visitsPerYear: data.visitsPerYear ?? 4,
          scope: data.scope ?? 'Comprehensive maintenance service',
        },
        include: INCLUDE,
      });
      return toDTO(row);
    });
  },
};
