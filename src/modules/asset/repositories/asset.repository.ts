import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

const ASSET_INCLUDE = {
  createdBy: { select: { id: true, name: true, user_name: true } },
  firm: { select: { id: true, firm_name: true } },
};

export const assetRepository = {
  findMany(filters: { status?: string; category?: string; search?: string; firmId?: string } = {}) {
    const where: Prisma.AssetWhereInput = {
      ...(filters.firmId ? { firmId: BigInt(filters.firmId) } : {}),
      ...(filters.status ? { status: filters.status as any } : {}),
      ...(filters.category ? { category: filters.category as any } : {}),
      ...(filters.search
        ? {
            OR: [
              { productName: { contains: filters.search, mode: 'insensitive' } },
              { assetCode: { contains: filters.search, mode: 'insensitive' } },
              { serialNo: { contains: filters.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return prisma.asset.findMany({
      where,
      include: ASSET_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  },

  findById(id: string) {
    return prisma.asset.findFirst({
      where: {
        OR: [
          { id },
          { assetCode: { equals: id, mode: 'insensitive' } },
          { serialNo: { equals: id, mode: 'insensitive' } },
        ],
      },
      include: ASSET_INCLUDE,
    });
  },

  create(data: Prisma.AssetCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.asset.create({ data, include: ASSET_INCLUDE });
  },

  update(id: string, data: Prisma.AssetUpdateInput) {
    return prisma.asset.update({ where: { id }, data, include: ASSET_INCLUDE });
  },

  delete(id: string) {
    return prisma.asset.delete({ where: { id } });
  },
};
