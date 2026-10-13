import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';

// The public vendor bid page (/bid/:token). The vendor has no login: the link token is the only credential, so these two
// endpoints see nothing but the rows of that token and can write nothing but the vendor's rate and its answer time.
// (Before, the page used the open generic /entity/quotation_history, which listed and edited every quotation.)
const MIN_TOKEN_LENGTH = 8;

function tokenOf(req: Request): string {
  const token = String(req.params.token || '').trim();
  if (token.length < MIN_TOKEN_LENGTH) throw new ApiError(404, 'Quotation not found');
  return token;
}

export class VendorBidController {
  // GET /api/store/vendor-bid/:token
  getByToken = asyncHandler(async (req: Request, res: Response) => {
    const rows = await prisma.quotationHistory.findMany({ where: { token: tokenOf(req) }, orderBy: { id: 'asc' } });

    // The page shows the vendor's and the project's addresses / GST numbers. It used to read the whole master registry for
    // them; now it gets exactly these two records, in the field names the page already uses.
    let vendor: Record<string, unknown> | null = null;
    let firm: Record<string, unknown> | null = null;
    if (rows.length > 0) {
      const v = await prisma.vendors.findFirst({ where: { vendor_name: rows[0].supplierName } });
      if (v) {
        vendor = {
          vendor_name: v.vendor_name, vendor_gstin: v.gstin, vendor_address: v.address, vendor_email: v.email, phone: v.phone,
          billing_address: v.address, destination_address: v.address,
        };
      }
      const firmName = (rows[0].firm || '').trim();
      const f = firmName ? await prisma.firm.findFirst({ where: { firm_name: firmName }, include: { company: true } }) : null;
      if (f) {
        firm = {
          firm_name: f.firm_name, company_gstin: f.company?.gstin ?? null, company_pan: f.company?.pan ?? null,
          company_address: f.company?.address ?? null, billing_address: f.billing_address ?? '', destination_address: f.destination_address ?? '',
        };
      }
    }
    res.json({ success: true, data: rows, vendor, firm });
  });

  // PATCH /api/store/vendor-bid/:token   body { indentNo, product, rate }
  submitRate = asyncHandler(async (req: Request, res: Response) => {
    const token = tokenOf(req);
    const indentNo = String(req.body?.indentNo ?? '').trim();
    const product = String(req.body?.product ?? '').trim().toLowerCase();
    const rate = Number(req.body?.rate);
    if (!indentNo || !product) throw new ApiError(400, 'indentNo and product are required');
    if (!Number.isFinite(rate) || rate < 0) throw new ApiError(400, 'rate must be a number');

    const rows = await prisma.quotationHistory.findMany({ where: { token, indentNo } });
    const target = rows.find((r) => (r.product || '').trim().toLowerCase() === product);
    if (!target) throw new ApiError(404, 'Quotation line not found');

    await prisma.quotationHistory.update({
      where: { id: target.id },
      data: { vendor_rate: rate, responded_at: new Date() },
    });
    res.json({ success: true });
  });
}
