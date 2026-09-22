import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export const INDENT_INCLUDE = {
  firm: { select: { id: true, firm_name: true } },
  machine: { select: { id: true, name: true, serialNumber: true, assetCode: true, departmentId: true, assetId: true, firmId: true, firm: { select: { id: true, firm_name: true } } } },
  machinePart: { select: { id: true, name: true, partNumber: true } },
  doer: { select: { id: true, name: true, user_name: true } },
  vendor: true,
  technician: true,
  parts: { include: { part: { select: { id: true, partName: true } } } },
  outhouseRepair: {
    include: {
      offers: { include: { vendor: true }, orderBy: { createdAt: 'desc' as const } },
      dispatch: true,
      receiving: { include: { inspectedBy: { select: { id: true, name: true, user_name: true } } } },
      payment: true,
    },
  },
} satisfies Prisma.RepairIndentInclude;

export const indentRepository = {
  findMany(where: Prisma.RepairIndentWhereInput, skip?: number, take?: number) {
    return prisma.repairIndent.findMany({ where, include: INDENT_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take });
  },
  count(where: Prisma.RepairIndentWhereInput) {
    return prisma.repairIndent.count({ where });
  },
  findById(id: string) {
    return prisma.repairIndent.findUnique({ where: { id }, include: INDENT_INCLUDE });
  },
  create(data: Prisma.RepairIndentCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.repairIndent.create({ data, include: INDENT_INCLUDE });
  },
  update(id: string, data: Prisma.RepairIndentUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.repairIndent.update({ where: { id }, data, include: INDENT_INCLUDE });
  },
};
