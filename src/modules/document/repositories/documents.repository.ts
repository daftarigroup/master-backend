import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const documentListSelect = {
  id: true,
  sn: true,
  companyName: true,
  documentType: true,
  category: true,
  documentName: true,
  needsRenewal: true,
  renewalDate: true,
  file: true,
  date: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const renewalListSelect = {
  id: true,
  documentId: true,
  sn: true,
  documentName: true,
  documentType: true,
  category: true,
  companyName: true,
  entryDate: true,
  oldRenewalDate: true,
  oldFile: true,
  renewalStatus: true,
  nextRenewalDate: true,
  newFile: true,
  createdAt: true,
} as const;

export interface DocumentFilters {
  companyName?: string;
  category?: string;
  documentType?: string;
  status?: string;
  needsRenewal?: boolean;
  search?: string;
  skip?: number;
  take?: number;
  includeContent?: boolean;
}

export const documentsRepository = {
  async findMany(filters: DocumentFilters = {}) {
    const search = filters.search?.trim();
    const where: Prisma.DocDocumentWhereInput = {
      ...(filters.companyName ? { companyName: { contains: filters.companyName, mode: 'insensitive' } } : {}),
      ...(filters.category ? { category: { contains: filters.category, mode: 'insensitive' } } : {}),
      ...(filters.documentType ? { documentType: { contains: filters.documentType, mode: 'insensitive' } } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.needsRenewal !== undefined ? { needsRenewal: filters.needsRenewal } : {}),
      ...(search
        ? {
            OR: [
              { documentName: { contains: search, mode: 'insensitive' } },
              { companyName: { contains: search, mode: 'insensitive' } },
              { sn: { contains: search, mode: 'insensitive' } },
              { documentType: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (filters.take !== undefined) {
      const safeTake = Math.min(Math.max(filters.take, 1), 500);
      const [items, total] = await Promise.all([
        prisma.docDocument.findMany({
          where,
          select: filters.includeContent ? undefined : documentListSelect,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip: filters.skip || 0,
          take: safeTake,
        }),
        prisma.docDocument.count({ where }),
      ]);
      return { items, total };
    }

    const items = await prisma.docDocument.findMany({
      where,
      select: filters.includeContent ? undefined : documentListSelect,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return { items, total: items.length };
  },

  findById(id: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docDocument.findUnique({ where: { id } });
  },

  create(data: Prisma.DocDocumentCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docDocument.create({ data });
  },

  update(id: string, data: Prisma.DocDocumentUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docDocument.update({ where: { id }, data });
  },

  remove(id: string) {
    return prisma.docDocument.delete({ where: { id } });
  },

  async findRenewals(options: { documentId?: string; search?: string; skip?: number; take?: number; includeContent?: boolean } = {}) {
    const search = options.search?.trim();
    const where: Prisma.DocRenewalWhereInput = {
      ...(options.documentId ? { documentId: options.documentId } : {}),
      ...(search
        ? {
            OR: [
              { documentName: { contains: search, mode: 'insensitive' } },
              { companyName: { contains: search, mode: 'insensitive' } },
              { sn: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (options.take !== undefined) {
      const [items, total] = await Promise.all([
        prisma.docRenewal.findMany({
          where,
          select: options.includeContent ? undefined : renewalListSelect,
          orderBy: { entryDate: 'desc' },
          skip: options.skip || 0,
          take: options.take,
        }),
        prisma.docRenewal.count({ where }),
      ]);
      return { items, total };
    }

    const items = await prisma.docRenewal.findMany({
      where,
      select: options.includeContent ? undefined : renewalListSelect,
      orderBy: { entryDate: 'desc' },
    });
    return { items, total: items.length };
  },

  createRenewal(data: Prisma.DocRenewalCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docRenewal.create({ data });
  },

  async findShares(options: { docSerial?: string; search?: string; skip?: number; take?: number } = {}) {
    const search = options.search?.trim();
    const where: Prisma.DocShareWhereInput = {
      ...(options.docSerial ? { docSerial: options.docSerial } : {}),
      ...(search
        ? {
            OR: [
              { docName: { contains: search, mode: 'insensitive' } },
              { docSerial: { contains: search, mode: 'insensitive' } },
              { recipientName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (options.take !== undefined) {
      const [items, total] = await Promise.all([
        prisma.docShare.findMany({
          where,
          orderBy: { dateTime: 'desc' },
          skip: options.skip || 0,
          take: options.take,
        }),
        prisma.docShare.count({ where }),
      ]);
      return { items, total };
    }

    const items = await prisma.docShare.findMany({
      where,
      orderBy: { dateTime: 'desc' },
    });
    return { items, total: items.length };
  },

  createShare(data: Prisma.DocShareCreateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.docShare.create({ data });
  },
};
