import { Response, Router } from 'express';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { validateParsed } from '../../../middleware/validateParsed.middleware';
import { asyncHandler } from '../../../utils/asyncHandler';
import { currentUserContext } from '../../../utils/currentUser';
import { ok } from '../../../utils/respond';
import { documentService as svc } from '../services/document.service';
import {
  changeFilesSchema, countsSchema, createDocumentSchema, createTypeSchema, documentIdSchema, downloadSchema, exportSchema, machineDocsSchema, presignSchema,
  registerSchema, typesSchema, updateDocumentSchema, voidDocumentSchema,
} from '../validators/document.validator';

// Mounted inside /api/fleet/documents (behind authenticateJWT + requireLogin). Every service call is firm-scoped and applies the
// document RBAC in lib/documentAccess.ts, so none of these endpoints trusts the screen.
const router = Router();
const ctx = (req: AuthenticatedRequest) => currentUserContext(req);
const body = <T = any>(req: AuthenticatedRequest) => req.body as T;
const query = <T = any>(req: AuthenticatedRequest) => req.query as unknown as T;
const id = (req: AuthenticatedRequest) => String(req.params.id);
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => asyncHandler(async (req: AuthenticatedRequest, res: Response) => void (await fn(req, res)));

router.get('/types', validateParsed(typesSchema), h(async (req, res) => ok(res, await svc.types(ctx(req), query(req)))));
router.post('/types', validateParsed(createTypeSchema), h(async (req, res) => ok(res, await svc.createType(ctx(req), body(req)), 201)));

router.post('/presign', validateParsed(presignSchema), h(async (req, res) => ok(res, await svc.presign(ctx(req), body(req)), 201)));

router.get('/counts', validateParsed(countsSchema), h(async (req, res) => ok(res, await svc.counts(ctx(req), query(req)))));
router.get('/export', validateParsed(exportSchema), h(async (req, res) => {
  const csv = await svc.exportCsv(ctx(req), query(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="documents-register.csv"');
  res.send(csv);
}));
router.get('/machine/:machineId', validateParsed(machineDocsSchema), h(async (req, res) => ok(res, await svc.forMachine(ctx(req), String(req.params.machineId)))));
router.get('/files/:fileId/download', validateParsed(downloadSchema), h(async (req, res) => ok(res, await svc.download(ctx(req), String(req.params.fileId), { inline: Boolean(query(req).inline) }))));

router.get('/', validateParsed(registerSchema), h(async (req, res) => ok(res, await svc.register(ctx(req), query(req)))));
router.post('/', validateParsed(createDocumentSchema), h(async (req, res) => {
  const r = await svc.create(ctx(req), body(req));
  // a retried save is the same document, not a new one
  return ok(res, r, r.idempotent ? 200 : 201);
}));
router.get('/:id', validateParsed(documentIdSchema), h(async (req, res) => ok(res, await svc.detail(ctx(req), id(req)))));
router.patch('/:id', validateParsed(updateDocumentSchema), h(async (req, res) => ok(res, await svc.update(ctx(req), id(req), body(req)))));
router.post('/:id/files', validateParsed(changeFilesSchema), h(async (req, res) => ok(res, await svc.changeFiles(ctx(req), id(req), body(req)))));
router.post('/:id/void', validateParsed(voidDocumentSchema), h(async (req, res) => ok(res, await svc.void(ctx(req), id(req), body(req).reason))));

export default router;
