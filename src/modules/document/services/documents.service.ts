import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentsRepository } from '../repositories/documents.repository';
import { docCounterService } from './docCounter.service';
import { sendEmail } from '../../../utils/email';

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
      subject,
      message,
      documentIds,
    }: {
      sharedVia: string;
      recipientName: string;
      contactInfo: string;
      subject?: string;
      message?: string;
      documentIds?: string[];
    }
  ) {
    const isBatch = documentId === 'batch' || (Array.isArray(documentIds) && documentIds.length > 0);
    const targetIds: string[] = isBatch
      ? (Array.isArray(documentIds) && documentIds.length > 0 ? documentIds : [])
      : [documentId];

    if (targetIds.length === 0 && documentId && documentId !== 'batch') {
      targetIds.push(documentId);
    }

    if (targetIds.length === 0) {
      throw ApiError.badRequest('No document IDs provided for sharing');
    }

    const documents = await prisma.docDocument.findMany({
      where: { id: { in: targetIds } },
    });

    if (!documents || documents.length === 0) {
      throw ApiError.notFound('Document(s) not found');
    }

    let emailResult: { success: boolean; data?: any; error?: any } | null = null;
    const isEmail =
      sharedVia?.toLowerCase() === 'email' ||
      (typeof contactInfo === 'string' && contactInfo.includes('@'));

    if (isEmail && contactInfo) {
      const isSingle = documents.length === 1;
      const primaryDoc = documents[0];
      const emailSubject =
        subject?.trim() ||
        (isSingle
          ? `Document Shared: ${primaryDoc.documentName || 'Document'}`
          : `${documents.length} Documents Shared with You`);

      const defaultTextMsg = isSingle
        ? `Hello ${recipientName || 'there'},\n\nPlease find attached the document: ${primaryDoc.documentName}.\n\nCompany: ${primaryDoc.companyName || 'N/A'}\nCategory: ${primaryDoc.category || 'N/A'}\nDocument Type: ${primaryDoc.documentType || 'N/A'}\n\nBest regards,\nPooja Construction`
        : `Hello ${recipientName || 'there'},\n\nPlease find attached ${documents.length} shared documents:\n${documents.map((d, i) => `${i + 1}. ${d.documentName} (${d.sn})`).join('\n')}\n\nBest regards,\nPooja Construction`;

      const emailText = message?.trim() || defaultTextMsg;

      const docRowsHtml = documents
        .map(
          (doc) => `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 10px 14px; font-weight: 600; color: #111827;">${doc.documentName}</td>
            <td style="padding: 10px 14px; font-family: monospace; font-size: 12px; color: #4b5563;">${doc.sn}</td>
            <td style="padding: 10px 14px; color: #4b5563;">${doc.companyName || '-'}</td>
            <td style="padding: 10px 14px; color: #4b5563;">${doc.category || '-'}</td>
            <td style="padding: 10px 14px; color: #4b5563;">${doc.documentType || '-'}</td>
          </tr>`
        )
        .join('');

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 20px 24px; border-radius: 10px; color: #ffffff; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.025em;">Pooja Construction Document Portal</h1>
            <p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Secure Document Sharing</p>
          </div>

          <div style="color: #374151; font-size: 14px; line-height: 1.6;">
            <p style="margin-top: 0;">Hello <strong>${recipientName || 'Valued Recipient'}</strong>,</p>
            <p>${message ? message.replace(/\n/g, '<br/>') : 'You have received the following document(s) shared via the Pooja Construction Document System:'}</p>

            <div style="margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                <thead>
                  <tr style="background-color: #f9fafb; border-bottom: 1px solid #e5e7eb; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">
                    <th style="padding: 10px 14px;">Document</th>
                    <th style="padding: 10px 14px;">Serial No</th>
                    <th style="padding: 10px 14px;">Company</th>
                    <th style="padding: 10px 14px;">Category</th>
                    <th style="padding: 10px 14px;">Type</th>
                  </tr>
                </thead>
                <tbody>
                  ${docRowsHtml}
                </tbody>
              </table>
            </div>

            <p style="font-size: 12px; color: #6b7280; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px;">
              Attached files have been included with this email where available. If you have any questions or require additional access, please contact the administrator.
            </p>
          </div>
        </div>
      `;

      const attachments: Array<{ filename: string; content?: Buffer; path?: string }> = [];

      for (const doc of documents) {
        if (doc.fileContent) {
          const matches = doc.fileContent.match(/^data:([^;]+);base64,(.+)$/);
          if (matches && matches[2]) {
            attachments.push({
              filename: doc.file || `${doc.documentName || 'Document'}.pdf`,
              content: Buffer.from(matches[2], 'base64'),
            });
          } else if (doc.fileContent.startsWith('http://') || doc.fileContent.startsWith('https://')) {
            attachments.push({
              filename: doc.file || `${doc.documentName || 'Document'}.pdf`,
              path: doc.fileContent,
            });
          }
        }
      }

      emailResult = await sendEmail({
        to: contactInfo,
        subject: emailSubject,
        html: htmlBody,
        text: emailText,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (!emailResult.success) {
        console.error('[Document Share] Failed to send email via Resend:', emailResult.error);
      }
    }

    // Record share logs in database
    const createdShares = await prisma.$transaction(async (tx) => {
      const records = [];
      for (const doc of documents) {
        const shareNo = await docCounterService.nextDocSerial('share', 'SH', tx);
        const record = await documentsRepository.createShare(
          {
            shareNo,
            docSerial: doc.sn,
            docName: doc.documentName,
            docFile: doc.file,
            sharedVia,
            recipientName,
            contactInfo,
          },
          tx
        );
        records.push(record);
      }
      return records;
    });

    return {
      shares: createdShares,
      share: createdShares[0],
      emailSent: emailResult?.success ?? (isEmail ? false : true),
      emailError: emailResult?.error ? (typeof emailResult.error === 'string' ? emailResult.error : JSON.stringify(emailResult.error)) : undefined,
    };
  },
};
