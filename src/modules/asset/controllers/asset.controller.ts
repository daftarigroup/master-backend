import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { currentUserId } from '../../../utils/currentUser';
import { assetService } from '../services/asset.service';

export const assetController = {
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await assetService.listAssets(req.query);
    res.json({ success: true, data });
  }),

  getById: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await assetService.getAssetById(String(req.params.id));
    res.json({ success: true, data });
  }),

  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await assetService.createAsset(req.body, currentUserId(req));
    res.status(201).json({ success: true, data });
  }),

  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const data = await assetService.updateAsset(String(req.params.id), req.body);
    res.json({ success: true, data });
  }),

  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await assetService.deleteAsset(String(req.params.id));
    res.status(204).send();
  }),
};
