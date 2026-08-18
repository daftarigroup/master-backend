import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { documentsService } from '../services/documents.service';

export const documentsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const filters = {
      ...req.query,
      ...(req.query.needsRenewal !== undefined ? { needsRenewal: req.query.needsRenewal === 'true' } : {}),
      ...(req.query.page !== undefined ? { page: parseInt(req.query.page as string, 10) } : {}),
      ...(req.query.limit !== undefined ? { limit: parseInt(req.query.limit as string, 10) } : {}),
      ...(req.query.search !== undefined ? { search: String(req.query.search) } : {}),
    };
    const result = await documentsService.listDocuments(filters);
    if (result && typeof result === 'object' && 'items' in result) {
      res.json({ success: true, data: result.items, pagination: (result as any).pagination });
    } else {
      res.json({ success: true, data: result });
    }
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const data = await documentsService.getDocumentById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await documentsService.createDocument(req.body);
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await documentsService.updateDocument(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    await documentsService.deleteDocument(String(req.params.id));
    res.json({ success: true, message: 'Document deleted' });
  }),

  listRenewals: asyncHandler(async (req: Request, res: Response) => {
    const options = {
      ...req.query,
      documentId: req.params.id ? String(req.params.id) : (req.query.documentId as string | undefined),
      ...(req.query.page !== undefined ? { page: parseInt(req.query.page as string, 10) } : {}),
      ...(req.query.limit !== undefined ? { limit: parseInt(req.query.limit as string, 10) } : {}),
      ...(req.query.search !== undefined ? { search: String(req.query.search) } : {}),
    };
    const result = await documentsService.listRenewals(options);
    if (result && typeof result === 'object' && 'items' in result) {
      res.json({ success: true, data: result.items, pagination: (result as any).pagination });
    } else {
      res.json({ success: true, data: result });
    }
  }),

  recordRenewal: asyncHandler(async (req: Request, res: Response) => {
    const data = await documentsService.recordRenewal(String(req.params.id), req.body);
    res.status(201).json({ success: true, data });
  }),

  listShares: asyncHandler(async (req: Request, res: Response) => {
    const options = {
      ...req.query,
      docSerial: req.params.serial ? String(req.params.serial) : (req.query.docSerial as string | undefined),
      ...(req.query.page !== undefined ? { page: parseInt(req.query.page as string, 10) } : {}),
      ...(req.query.limit !== undefined ? { limit: parseInt(req.query.limit as string, 10) } : {}),
      ...(req.query.search !== undefined ? { search: String(req.query.search) } : {}),
    };
    const result = await documentsService.listShares(options);
    if (result && typeof result === 'object' && 'items' in result) {
      res.json({ success: true, data: result.items, pagination: (result as any).pagination });
    } else {
      res.json({ success: true, data: result });
    }
  }),

  recordShare: asyncHandler(async (req: Request, res: Response) => {
    const data = await documentsService.recordShare(String(req.params.id), req.body);
    res.status(201).json({ success: true, data });
  }),
};
