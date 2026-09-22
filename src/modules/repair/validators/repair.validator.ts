import { z } from 'zod';

export const createIndentSchema = z.object({
  body: z.object({
    machineId: z.string().optional(),
    machineName: z.string().optional(),
    machineSerialNo: z.string().optional(),
    machinePartId: z.string().optional(),
    doerUserId: z.string().optional(),
    departmentId: z.string().optional(),
    problem: z.string().trim().min(1, 'problem is required'),
    priority: z.enum(['High', 'Medium', 'Low']).optional(),
    expectedDeliveryDays: z.coerce.number().int().positive().optional(),
    location: z.string().optional(),
    remarks: z.string().optional(),
    soundOfMachine: z.string().optional(),
    temperature: z.string().optional(),
    vendorId: z.string().optional(),
    image: z.string().optional(),
  }),
});

export const approveIndentSchema = z.object({
  body: z.object({ approvalStatus: z.enum(['Inhouse', 'Outhouse']), approvalRemarks: z.string().optional() }),
});

export const createVendorSchema = z.object({
  body: z.object({ name: z.string().trim().min(1, 'name is required'), type: z.string().optional() }),
});

export const createTechnicianSchema = z.object({
  body: z.object({ name: z.string().trim().min(1, 'name is required'), contact: z.string().optional() }),
});

export const createSparePartSchema = z.object({
  body: z.object({ partName: z.string().trim().min(1, 'partName is required') }),
});

export const createAmcSchema = z.object({
  body: z.object({ machineId: z.string().min(1, 'machineId is required'), annualCost: z.coerce.number().nonnegative().optional() }),
});
