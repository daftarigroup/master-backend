import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserContext, currentUserId } from '../../../utils/currentUser';
import { canViewCost } from '../../../middleware/requireCostAccess';
import { stripAssetCostInput, withoutAssetCost } from '../services/asset.mapper';
import { toPublicAsset } from '../services/publicAsset';
import { assetService } from '../services/asset.service';

// Purchase cost, supplier and repair spend go only to users who may see cost; everyone else gets the record without those fields.
const costAllowed = (req: AuthenticatedRequest) => canViewCost(currentUserContext(req));
const shape = <T extends Record<string, any>>(allowed: boolean, row: T) => (allowed ? row : withoutAssetCost(row));

export const assetController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const allowed = await costAllowed(req);
    const rows = await assetService.listAssets(req.query);
    res.json({ success: true, data: rows.map((r) => shape(allowed, r)) });
  }),

  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const allowed = await costAllowed(req);
    const data = await assetService.getAssetById(String(req.params.id));
    res.json({ success: true, data: shape(allowed, data) });
  }),

  getPublic: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await assetService.getAssetById(String(req.params.id));
    res.json({ success: true, data: toPublicAsset(data as unknown as Record<string, unknown>) });
  }),

  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const allowed = await costAllowed(req);
    const data = await assetService.createAsset(allowed ? req.body : stripAssetCostInput(req.body), currentUserId(req));
    res.status(201).json({ success: true, data: shape(allowed, data) });
  }),

  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const allowed = await costAllowed(req);
    const data = await assetService.updateAsset(String(req.params.id), allowed ? req.body : stripAssetCostInput(req.body));
    res.json({ success: true, data: shape(allowed, data) });
  }),

  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await assetService.deleteAsset(String(req.params.id));
    res.status(204).send();
  }),
};
