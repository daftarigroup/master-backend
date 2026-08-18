import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const subscriptionListSelect = {
  id: true,
  sn: true,
  requestedDate: true,
  companyName: true,
  subscriberName: true,
  subscriptionName: true,
  price: true,
  frequency: true,
  purpose: true,
  startDate: true,
  endDate: true,
  status: true,
  plan: true,
  file: true,
  approvalNo: true,
  approvalDate: true,
  paymentDate: true,
  paymentMethod: true,
  paymentFile: true,
  remarks: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface SubscriptionFilters {
  companyName?: string;
  status?: string;
  frequency?: string;
  search?: string;
  skip?: number;
  take?: number;
  includeContent?: boolean;
}

export const subscriptionsRepository = {
  async findMany(filters: SubscriptionFilters = {}) {
    const search = filters.search?.trim();
    const where: Prisma.DocSubscriptionWhereInput = {
      ...(filters.companyName ? { companyName: { contains: filters.companyName, mode: 'insensitive' } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.frequency ? { frequency: filters.frequency } : {}),
      ...(search
        ? {
            OR: [
              { subscriptionName: { contains: search, mode: 'insensitive' } },
              { companyName: { contains: search, mode: 'insensitive' } },
              { subscriberName: { contains: search, mode: 'insensitive' } },
              { sn: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (filters.take !== undefined) {
      const [items, total] = await Promise.all([
        prisma.docSubscription.findMany({
          where,
          select: filters.includeContent ? undefined : subscriptionListSelect,
          orderBy: [{ requestedDate: 'desc' }, { createdAt: 'desc' }],
          skip: filters.skip || 0,
          take: filters.take,
        }),
        prisma.docSubscription.count({ where }),
      ]);
      return { items, total };
    }

    const items = await prisma.docSubscription.findMany({
      where,
      select: filters.includeContent ? undefined : subscriptionListSelect,
      orderBy: [{ requestedDate: 'desc' }, { createdAt: 'desc' }],
    });
    return { items, total: items.length };
  },

  findById(id: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docSubscription.findUnique({ where: { id } });
  },

  create(data: Prisma.DocSubscriptionCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docSubscription.create({ data });
  },

  update(id: string, data: Prisma.DocSubscriptionUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docSubscription.update({ where: { id }, data });
  },

  remove(id: string) {
    return prisma.docSubscription.delete({ where: { id } });
  },

  async findRenewals(options: { subscriptionId?: string; search?: string; skip?: number; take?: number } = {}) {
    const search = options.search?.trim();
    const where: Prisma.DocSubscriptionRenewalWhereInput = {
      ...(options.subscriptionId ? { subscriptionId: options.subscriptionId } : {}),
      ...(search
        ? {
            OR: [
              { subscriptionName: { contains: search, mode: 'insensitive' } },
              { companyName: { contains: search, mode: 'insensitive' } },
              { subscriberName: { contains: search, mode: 'insensitive' } },
              { sn: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (options.take !== undefined) {
      const [items, total] = await Promise.all([
        prisma.docSubscriptionRenewal.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: options.skip || 0,
          take: options.take,
        }),
        prisma.docSubscriptionRenewal.count({ where }),
      ]);
      return { items, total };
    }

    const items = await prisma.docSubscriptionRenewal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { items, total: items.length };
  },

  createRenewal(data: Prisma.DocSubscriptionRenewalCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docSubscriptionRenewal.create({ data });
  },
};
