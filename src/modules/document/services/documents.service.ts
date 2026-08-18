import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentsRepository } from '../repositories/documents.repository';
import { docCounterService } from './docCounter.service';

function safeDate(val: any, fallback: Date | null = null): Date | null {
  if (!val) return fallback;
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

export const documentsService = {
  async listDocuments(filters: any = {}) {
    const page = filters.page ? Math.max(1, parseInt(String(filters.page), 10) || 1) : undefined;
    const limit = filters.limit ? Math.max(1, parseInt(String(filters.limit), 10) || 25) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const { items, total } = await documentsRepository.findMany({
      ...filters,
      skip,
      take,
    });

    if (page && limit) {
      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }
    return items;
  },

  async getDocumentById(id: string) {
    const document = await documentsRepository.findById(id);
    if (!document) throw ApiError.notFound('Document not found');
    return document;
  },

  async createDocument({
    companyName,
    documentType,
    category,
    documentName,
    needsRenewal,
    renewalDate,
    file,
    fileContent,
    date,
  }: {
    companyName: string;
    documentType: string;
    category: string;
    documentName: string;
    needsRenewal?: boolean;
    renewalDate?: string | Date | null;
    file?: string;
    fileContent?: string;
    date: string | Date;
  }) {
    return prisma.$transaction(async (tx) => {
      const sn = await docCounterService.nextDocSerial('document', 'SN', tx);
      return documentsRepository.create(
        {
          sn,
          companyName,
          documentType,
          category,
          documentName,
          needsRenewal: !!needsRenewal,
          renewalDate: needsRenewal ? safeDate(renewalDate) : null,
          file,
          fileContent,
          date: safeDate(date, new Date()) || new Date(),
        },
        tx
      );
    });
  },

  async updateDocument(id: string, data: any) {
    await this.getDocumentById(id);
    const {
      companyName,
      documentType,
      category,
      documentName,
      needsRenewal,
      renewalDate,
      file,
      fileContent,
      date,
      status,
    } = data;
    return documentsRepository.update(id, {
      ...(companyName !== undefined ? { companyName } : {}),
      ...(documentType !== undefined ? { documentType } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(documentName !== undefined ? { documentName } : {}),
      ...(needsRenewal !== undefined ? { needsRenewal: !!needsRenewal } : {}),
      ...(renewalDate !== undefined ? { renewalDate: safeDate(renewalDate) } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(fileContent !== undefined ? { fileContent } : {}),
      ...(date !== undefined ? { date: safeDate(date) || new Date() } : {}),
      ...(status !== undefined ? { status } : {}),
    });
  },

  async deleteDocument(id: string) {
    await this.getDocumentById(id);
    await documentsRepository.remove(id);
  },

  async listRenewals(options: any = {}) {
    const documentId = typeof options === 'string' ? options : options.documentId;
    const page = options.page ? Math.max(1, parseInt(String(options.page), 10) || 1) : undefined;
    const limit = options.limit ? Math.max(1, parseInt(String(options.limit), 10) || 25) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const { items, total } = await documentsRepository.findRenewals({
      documentId,
      search: typeof options === 'object' ? options.search : undefined,
      skip,
      take,
    });

    if (page && limit) {
      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }
    return items;
  },

  async recordRenewal(
    documentId: string,
    {
      nextRenewalDate,
      newFile,
      newFileContent,
      renewalStatus,
    }: {
      nextRenewalDate?: string | Date | null;
      newFile?: string;
      newFileContent?: string;
      renewalStatus?: string;
    }
  ) {
    const document = await this.getDocumentById(documentId);

    return prisma.$transaction(async (tx) => {
      const renewal = await documentsRepository.createRenewal(
        {
          documentId,
          sn: document.sn,
          documentName: document.documentName,
          documentType: document.documentType,
          category: document.category,
          companyName: document.companyName,
          entryDate: new Date(),
          oldRenewalDate: document.renewalDate,
          oldFile: document.file,
          oldFileContent: document.fileContent,
          renewalStatus: renewalStatus || 'Yes',
          nextRenewalDate: safeDate(nextRenewalDate),
          newFile,
          newFileContent,
        },
        tx
      );

      await documentsRepository.update(
        documentId,
        {
          renewalDate: safeDate(nextRenewalDate) || document.renewalDate,
          ...(newFile !== undefined ? { file: newFile } : {}),
          ...(newFileContent !== undefined ? { fileContent: newFileContent } : {}),
        },
        tx
      );

      return renewal;
    });
  },

  async listShares(options: any = {}) {
    const docSerial = typeof options === 'string' ? options : options.docSerial;
    const page = options.page ? Math.max(1, parseInt(String(options.page), 10) || 1) : undefined;
    const limit = options.limit ? Math.max(1, parseInt(String(options.limit), 10) || 25) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const { items, total } = await documentsRepository.findShares({
      docSerial,
      search: typeof options === 'object' ? options.search : undefined,
      skip,
      take,
    });

    if (page && limit) {
      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }
    return items;
  },

  async recordShare(
    documentId: string,
    {
      sharedVia,
      recipientName,
      contactInfo,
    }: {
      sharedVia: string;
      recipientName: string;
      contactInfo: string;
    }
  ) {
    const document = await this.getDocumentById(documentId);

    return prisma.$transaction(async (tx) => {
      const shareNo = await docCounterService.nextDocSerial('share', 'SH', tx);
      return documentsRepository.createShare(
        {
          shareNo,
          docSerial: document.sn,
          docName: document.documentName,
          docFile: document.file,
          sharedVia,
          recipientName,
          contactInfo,
        },
        tx
      );
    });
  },
};
