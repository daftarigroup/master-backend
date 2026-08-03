import { z } from 'zod';

export const updateIndentApprovalSchema = z.object({
  body: z.object({
    actual1: z.string().min(1, 'actual1 is required'),
    vendor_type: z.string(),
    approved_quantity: z.number(),
    planned2: z.string().optional(),
    status: z.string().optional(),
    indent_url: z.string().optional(),
  }),
});

export const updateIndentSpecificationsSchema = z.object({
  body: z.object({
    specifications: z.string(),
  }),
});

export const updateIndentHistoryFieldsSchema = z.object({
  body: z.object({
    approved_quantity: z.number().optional(),
    uom: z.string().optional(),
    vendor_type: z.string().optional(),
  }),
});

export const updateIndentVendorSelectionSchema = z.object({
  body: z.object({
    actual2: z.string(),
    vendor_name: z.string(),
    negotiated_rate: z.number(),
    planned3: z.string(),
  }),
});

export const updateIndentHODApprovalSchema = z.object({
  body: z.object({
    actual3: z.string(),
    comparative_analysis: z.string(),
    attachment3: z.string(),
    planned4: z.string(),
  }),
});

export const updateIndentPOCreationSchema = z.object({
  body: z.object({
    actual4: z.string(),
    po_number: z.string(),
    po_date: z.string(),
    po_copy: z.string(),
    planned5: z.string(),
  }),
});

export const updateIndentPaymentTermsSchema = z.object({
  body: z.object({
    actual5: z.string(),
    transportation_include: z.string(),
    tax_extra: z.string(),
    credit_days: z.number(),
    remarks5: z.string(),
  }),
});

export const updateIndentStoreOutApprovalSchema = z.object({
  body: z.object({
    approved_by: z.string(),
    approved_date: z.string(),
    approved_quantity: z.number(),
    status: z.string(),
  }),
});
