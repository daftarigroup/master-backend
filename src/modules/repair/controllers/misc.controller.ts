import { Response } from 'express';
import { asyncHandler } from '../../../utils/asyncHandler';
import { AuthenticatedRequest } from '../../../middleware/auth.middleware';
import { vendorService } from '../services/vendor.service';
import { technicianService } from '../services/technician.service';
import { sparePartService } from '../services/sparePart.service';
import { amcService } from '../services/amc.service';

export const vendorController = {
  list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await vendorService.list() });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ status: 'success', data: await vendorService.create(req.body) });
  }),
};

export const technicianController = {
  list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await technicianService.list() });
  }),
  page: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await technicianService.page(req.query) });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ status: 'success', data: await technicianService.create(req.body) });
  }),
  update: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await technicianService.update(String(req.params.id), req.body) });
  }),
  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await technicianService.delete(String(req.params.id));
    res.status(204).send();
  }),
};

export const sparePartController = {
  list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await sparePartService.list() });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ status: 'success', data: await sparePartService.create(req.body) });
  }),
  uniqueVendors: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await sparePartService.uniqueVendorNames() });
  }),
  uniqueParts: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await sparePartService.uniquePartNames() });
  }),
  uniqueMachineTypes: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await sparePartService.uniqueMachineTypes() });
  }),
  delete: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await sparePartService.delete(String(req.params.id));
    res.status(204).send();
  }),
};

export const amcController = {
  list: asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    res.json({ status: 'success', data: await amcService.list() });
  }),
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.status(201).json({ status: 'success', data: await amcService.create(req.body) });
  }),
};
