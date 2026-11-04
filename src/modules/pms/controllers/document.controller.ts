import { Request, Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { pmsService } from '../services/project.service';

export class DocumentController {
  listDocuments = asyncHandler(async (req: Request, res: Response) => {
    const projectNo = (req.query.project_no || req.query.projectNo) as string | undefined;
    const docs = await pmsService.listDocuments(projectNo);
    res.json({ success: true, data: docs });
  });

  createDocument = asyncHandler(async (req: Request, res: Response) => {
    const doc = await pmsService.createDocument(req.body);
    res.status(201).json({ success: true, data: doc, message: 'Document created successfully' });
  });

  deleteDocument = asyncHandler(async (req: Request, res: Response) => {
    await pmsService.deleteDocument(String(req.params.docId));
    res.json({ success: true, message: 'Document deleted successfully' });
  });

  listEmailLogs = asyncHandler(async (req: Request, res: Response) => {
    const projectNo = (req.query.project_no || req.query.projectNo) as string | undefined;
    const logs = await pmsService.listEmailLogs(projectNo);
    res.json({ success: true, data: logs });
  });

  createEmailLog = asyncHandler(async (req: Request, res: Response) => {
    const log = await pmsService.createEmailLog(req.body);
    res.status(201).json({ success: true, data: log, message: 'Email log recorded successfully' });
  });
}

export const documentController = new DocumentController();
