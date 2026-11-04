import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';

// Indent pipeline: Pending → IndentApproved → VendorRated → TechnicalApproved → ManagementApproved → POCreated.
// Rejected can happen at Indent Approval or Management Approval.
export const INDENT_STAGES = [
  'Pending',
  'IndentApproved',
  'VendorRated',
  'TechnicalApproved',
  'ManagementApproved',
  'POCreated',
  'Rejected',
] as const;

// ?reviewed=<step> lists every indent that has been through that step, whatever its current stage (the History tabs)
const REVIEWED_FIELDS: Record<string, string> = {
  indent: 'indent_approved_at',
  vendor: 'vendor_rated_at',
  technical: 'technical_approved_at',
  management: 'management_approved_at',
};

const INDENT_INCLUDE = {
  items: { orderBy: { id: 'asc' } },
  vendors: { orderBy: { id: 'asc' } },
  selected_vendor: true,
  pos: { select: { id: true, po_number: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.PMSIndentInclude;

type IndentWithRelations = Prisma.PMSIndentGetPayload<{ include: typeof INDENT_INCLUDE }>;

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

const parseDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const parseId = (val: any, label = 'id'): number => {
  const id = Number(val);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Invalid ${label}: ${val}`);
  return id;
};

const actorOf = (body: any, user?: any): string | null => body?.approved_by || (user?.id ? `user#${user.id}` : null);

function toVendorDTO(v: IndentWithRelations['vendors'][number]) {
  return {
    ...v,
    rate: num(v.rate),
    gst_percent: num(v.gst_percent),
    quotation_file: v.quotation_url,
  };
}

// The pages read a few fields under older names (expected_date, attachment, status, *_remarks), so those are added alongside
// the column names rather than renamed.
function toIndentDTO(ind: IndentWithRelations) {
  return {
    ...ind,
    approved_rate: num(ind.approved_rate),
    status: ind.indent_status,
    approval_remarks: ind.indent_approval_remarks,
    technical_remarks: ind.technical_approval_remarks,
    management_remarks: ind.management_approval_remarks,
    selected_vendor: ind.selected_vendor ? toVendorDTO(ind.selected_vendor) : null,
    po_number: ind.pos[0]?.po_number ?? null,
    items: ind.items.map((it) => ({
      ...it,
      quantity: num(it.quantity),
      approved_quantity: num(it.approved_quantity),
      current_stock_qty: num(it.current_stock_qty),
      day_charge: num(it.day_charge),
      expected_date: it.expected_requirement_date,
      attachment: it.attachment_url,
    })),
    vendors: ind.vendors.map(toVendorDTO),
  };
}

type POWithItems = Prisma.PMSPOGetPayload<{ include: { items: true } }>;

function toPODTO(po: POWithItems) {
  const items = po.items.map((it) => ({
    ...it,
    quantity: num(it.quantity),
    rate: num(it.rate),
    gst_percent: num(it.gst_percent),
    discount_percent: num(it.discount_percent),
    amount: num(it.amount),
  }));
  const terms = Array.isArray(po.terms) ? (po.terms as any[]) : [];
  return {
    ...po,
    sub_total: num(po.sub_total),
    gst_amount: num(po.gst_amount),
    grand_total: num(po.grand_total),
    items,
    line_items: items,
    payment_terms: items.find((it) => it.payment_terms)?.payment_terms ?? null,
    delivery_address: po.destination_address,
    terms_conditions: terms.length ? terms.map((t, i) => `${i + 1}. ${typeof t === 'string' ? t : t?.text ?? ''}`).join('\n') : null,
  };
}

// Indian financial year (Apr–Mar), e.g. "26-27"
function financialYear(date = new Date()): string {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export class PMSProcurementService {
  private async loadIndent(tx: Prisma.TransactionClient, id: number, allowedStages: string[], action: string) {
    const indent = await tx.pMSIndent.findUnique({ where: { id }, include: { vendors: true } });
    if (!indent) throw new ApiError(404, `Indent not found: ${id}`);
    if (!allowedStages.includes(indent.stage)) {
      throw new ApiError(409, `Indent ${indent.indent_number} is at stage "${indent.stage}" and cannot be sent to ${action}`);
    }
    return indent;
  }

  private async getIndentDTO(tx: Prisma.TransactionClient, id: number) {
    const indent = await tx.pMSIndent.findUniqueOrThrow({ where: { id }, include: INDENT_INCLUDE });
    return toIndentDTO(indent);
  }

  // --- Indents ---
  async listIndents(query: any) {
    const where: Prisma.PMSIndentWhereInput = {};

    // `status` is the older name of `stage`
    const stageParam = query?.stage ?? query?.status;
    if (stageParam) {
      const stages = String(stageParam).split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = stages.filter((s) => !(INDENT_STAGES as readonly string[]).includes(s));
      if (unknown.length) throw new ApiError(400, `Unknown stage: ${unknown.join(', ')}`);
      where.stage = { in: stages };
    }

    if (query?.reviewed) {
      const field = REVIEWED_FIELDS[String(query.reviewed)];
      if (!field) throw new ApiError(400, `Unknown reviewed step: ${query.reviewed}`);
      (where as any)[field] = { not: null };
    }

    if (query?.po_required !== undefined) where.po_required = String(query.po_required) === 'true';
    if (query?.project_id) where.project_id = BigInt(query.project_id);

    const indents = await prisma.pMSIndent.findMany({ where, include: INDENT_INCLUDE, orderBy: { created_at: 'desc' } });
    return indents.map(toIndentDTO);
  }

  async createIndent(data: any) {
    const { project_id, indenter_name, priority, indent_date, products = [], equipments = [] } = data;
    if (!project_id) throw new ApiError(400, 'project_id is required');
    if (!indenter_name) throw new ApiError(400, 'indenter_name is required');
    if (products.length + equipments.length === 0) throw new ApiError(400, 'At least one product or equipment is required');

    const project = await prisma.pMSProject.findUnique({ where: { id: BigInt(project_id) } });
    if (!project) throw new ApiError(404, `Project not found: ${project_id}`);

    const productItems = products.map((p: any) => ({
      indent_type: 'Product',
      group_head: p.group_head,
      product_name: p.product_name,
      quantity: p.quantity ?? 0,
      current_stock_qty: p.current_stock_qty ?? 0,
      uom: p.uom,
      area_of_use: p.area_of_use,
      expected_requirement_date: parseDate(p.expected_requirement_date) ?? new Date(),
      attachment_url: p.attachment_url ?? null,
      specifications: p.specifications ?? null,
    }));

    const equipmentItems = equipments.map((e: any) => ({
      indent_type: 'Equipment',
      group_head: e.group_head,
      product_name: e.equipment_name,
      quantity: 0,
      current_stock_qty: 0,
      uom: 'Unit',
      area_of_use: e.area_of_use,
      expected_requirement_date: new Date(),
      equipment_type: e.type,
      expected_time: e.expected_time ?? null,
      day_charge: e.day_charge ?? null,
    }));

    return prisma.$transaction(async (tx) => {
      const last = await tx.pMSIndent.findFirst({ where: { indent_number: { startsWith: 'PI-' } }, orderBy: { id: 'desc' } });
      const n = last ? parseInt(last.indent_number.replace('PI-', ''), 10) || 0 : 0;

      const indent = await tx.pMSIndent.create({
        data: {
          indent_number: `PI-${String(n + 1).padStart(4, '0')}`,
          project_id: BigInt(project_id),
          project_name: project.project_name,
          indenter_name,
          priority: priority || 'Normal',
          indent_date: parseDate(indent_date) ?? new Date(),
          stage: 'Pending',
          items: { create: [...productItems, ...equipmentItems] },
        },
      });
      return this.getIndentDTO(tx, indent.id);
    });
  }

  async approveIndent(idParam: any, data: any, user?: any) {
    const id = parseId(idParam);
    const status = data?.status;
    if (status !== 'Approved' && status !== 'Rejected') throw new ApiError(400, 'status must be "Approved" or "Rejected"');

    return prisma.$transaction(async (tx) => {
      await this.loadIndent(tx, id, ['Pending'], 'Indent Approval');
      await tx.pMSIndent.update({
        where: { id },
        data: {
          stage: status === 'Approved' ? 'IndentApproved' : 'Rejected',
          indent_status: status,
          indent_approved_at: new Date(),
          indent_approved_by: actorOf(data, user),
          indent_approval_remarks: data.remarks || null,
        },
      });
      return this.getIndentDTO(tx, id);
    });
  }

  // Replaces the indent's vendor quotes. Allowed again while still VendorRated, so a quote can be corrected before Technical Approval.
  async updateVendorRates(idParam: any, data: any) {
    const id = parseId(idParam);
    const vendors = Array.isArray(data?.vendors) ? data.vendors : [];
    if (vendors.length === 0) throw new ApiError(400, 'At least one vendor quote is required');
    vendors.forEach((v: any, i: number) => {
      if (!String(v?.vendor_name || '').trim()) throw new ApiError(400, `Vendor #${i + 1}: vendor_name is required`);
      if (!(Number(v.rate) > 0)) throw new ApiError(400, `Vendor #${i + 1}: rate must be greater than 0`);
    });

    return prisma.$transaction(async (tx) => {
      await this.loadIndent(tx, id, ['IndentApproved', 'VendorRated'], 'Vendor Rate Update');
      await tx.pMSIndentVendor.deleteMany({ where: { indent_id: id } });
      await tx.pMSIndentVendor.createMany({
        data: vendors.map((v: any) => ({
          indent_id: id,
          vendor_name: String(v.vendor_name).trim(),
          rate: Number(v.rate),
          gst_percent: Number(v.gst_percent) || 0,
          payment_terms: v.payment_terms || null,
          delivery_days: v.delivery_days ? Number(v.delivery_days) : null,
          quotation_url: v.quotation_url || null,
          quotation_filename: v.quotation_filename || null,
          enquiry_no: v.enquiry_no || null,
          enquiry_date: v.enquiry_date ? new Date(v.enquiry_date) : null,
          rate_unit: v.rate_unit || null,
          whatsapp: v.whatsapp || null,
          email: v.email || null,
          make: v.make || null,
        })),
      });
      await tx.pMSIndent.update({
        where: { id },
        data: {
          stage: 'VendorRated',
          vendor_rated_at: new Date(),
          selected_vendor_id: null,
          vendor_type: data.vendor_type || null,
          product_code: data.product_code || null,
          comparison_sheet_url: data.comparison_sheet_url || null,
          comparison_sheet_filename: data.comparison_sheet_filename || null,
        },
      });
      return this.getIndentDTO(tx, id);
    });
  }

  async technicalApproval(idParam: any, data: any, user?: any) {
    const id = parseId(idParam);
    const vendorId = Number(data?.selected_vendor_id ?? data?.selected_vendor?.id);
    if (!vendorId) throw new ApiError(400, 'selected_vendor is required');

    return prisma.$transaction(async (tx) => {
      const indent = await this.loadIndent(tx, id, ['VendorRated'], 'Technical Approval');
      if (!indent.vendors.some((v) => v.id === vendorId)) {
        throw new ApiError(400, `Vendor ${vendorId} is not one of the quotes on indent ${indent.indent_number}`);
      }
      await tx.pMSIndent.update({
        where: { id },
        data: {
          stage: 'TechnicalApproved',
          selected_vendor_id: vendorId,
          technical_approved_at: new Date(),
          technical_approved_by: actorOf(data, user),
          technical_approval_remarks: data.remarks || null,
        },
      });
      return this.getIndentDTO(tx, id);
    });
  }

  async managementApproval(idParam: any, data: any, user?: any) {
    const id = parseId(idParam);
    const status = data?.status;
    const isApproved = status === 'ManagementApproved' || status === 'Approved';
    if (!isApproved && status !== 'Rejected') throw new ApiError(400, 'status must be "ManagementApproved" or "Rejected"');
    if (isApproved && !(Number(data.approved_rate) > 0)) throw new ApiError(400, 'approved_rate must be greater than 0');

    return prisma.$transaction(async (tx) => {
      const indent = await this.loadIndent(tx, id, ['TechnicalApproved'], 'Management Approval');
      const selected = indent.vendors.find((v) => v.id === indent.selected_vendor_id);
      await tx.pMSIndent.update({
        where: { id },
        data: {
          stage: isApproved ? 'ManagementApproved' : 'Rejected',
          management_approved_at: new Date(),
          management_approved_by: actorOf(data, user),
          management_approval_remarks: data.remarks || null,
          approved_vendor_name: isApproved ? data.approved_vendor_name || selected?.vendor_name || null : null,
          approved_rate: isApproved ? Number(data.approved_rate) : null,
          po_required: isApproved && data.po_required !== false,
        },
      });
      return this.getIndentDTO(tx, id);
    });
  }

  async deleteIndent(idParam: any) {
    const id = parseId(idParam);
    const indent = await prisma.pMSIndent.findUnique({ where: { id }, include: { pos: { select: { po_number: true } } } });
    if (!indent) throw new ApiError(404, `Indent not found: ${id}`);
    if (indent.pos.length) {
      throw new ApiError(409, `Indent ${indent.indent_number} has PO ${indent.pos.map((p) => p.po_number).join(', ')} and cannot be deleted`);
    }
    await prisma.pMSIndent.delete({ where: { id } });
  }

  // --- Purchase orders ---
  async listPOs(query: any) {
    const where: Prisma.PMSPOWhereInput = {};
    if (query?.project_id) where.project_id = BigInt(query.project_id);
    if (query?.indent_id) where.indent_id = parseId(query.indent_id, 'indent_id');
    const pos = await prisma.pMSPO.findMany({ where, include: { items: { orderBy: { id: 'asc' } } }, orderBy: { created_at: 'desc' } });
    return pos.map(toPODTO);
  }

  async getPO(idParam: any) {
    const po = await prisma.pMSPO.findUnique({ where: { id: parseId(idParam) }, include: { items: { orderBy: { id: 'asc' } } } });
    if (!po) throw new ApiError(404, `PO not found: ${idParam}`);
    return toPODTO(po);
  }

  // Same numbering as the Create PO page: "<FY>/<NN>", revisions "<FY>/<NN>-<RR>"
  private async nextPoNumber(tx: Prisma.TransactionClient): Promise<string> {
    const prefix = `${financialYear()}/`;
    const rows = await tx.pMSPO.findMany({ where: { po_number: { startsWith: prefix } }, select: { po_number: true } });
    const max = rows.reduce((m, r) => Math.max(m, parseInt(r.po_number.slice(prefix.length).split('-')[0], 10) || 0), 0);
    return `${prefix}${String(max + 1).padStart(2, '0')}`;
  }

  async createPO(data: any) {
    const lineItems = Array.isArray(data?.line_items) ? data.line_items : [];
    if (!String(data?.vendor_name || '').trim()) throw new ApiError(400, 'vendor_name is required');
    if (lineItems.length === 0) throw new ApiError(400, 'At least one line item is required');
    lineItems.forEach((it: any, i: number) => {
      if (!String(it?.product_name || '').trim()) throw new ApiError(400, `Line ${i + 1}: product_name is required`);
      if (!(Number(it.quantity) > 0)) throw new ApiError(400, `Line ${i + 1}: quantity must be greater than 0`);
    });

    try {
      return await prisma.$transaction(async (tx) => {
        // When the PO comes from an indent, the indent decides the project. A revision may reuse an indent that already has a PO.
        const indentId = data.indent_id ? parseId(data.indent_id, 'indent_id') : null;
        const indent = indentId ? await this.loadIndent(tx, indentId, ['ManagementApproved', 'POCreated'], 'Create PO') : null;

        const projectId = indent ? indent.project_id : data.project_id ? BigInt(data.project_id) : null;
        if (!projectId) throw new ApiError(400, 'project_id is required when the PO has no indent');
        const project = await tx.pMSProject.findUnique({ where: { id: projectId } });
        if (!project) throw new ApiError(404, `Project not found: ${projectId}`);

        const indentNumber = indent?.indent_number ?? String(data.indent_number || '');

        const po = await tx.pMSPO.create({
          data: {
            po_number: String(data.po_number || '').trim() || (await this.nextPoNumber(tx)),
            po_date: parseDate(data.po_date) ?? new Date(),
            indent_id: indent?.id ?? null,
            indent_number: indentNumber,
            project_id: projectId,
            project_name: project.project_name,
            vendor_name: String(data.vendor_name).trim(),
            vendor_address: data.vendor_address || null,
            vendor_gstin: data.vendor_gstin || null,
            vendor_email: data.vendor_email || null,
            enquiry_no: data.enquiry_no || null,
            enquiry_date: parseDate(data.enquiry_date),
            delivery_date: parseDate(data.delivery_date),
            delivery_days: data.delivery_days ? Number(data.delivery_days) : null,
            delivery_type: data.delivery_type || null,
            destination_address: data.destination_address || null,
            site_engineer_name: data.site_engineer_name || null,
            site_engineer_phone: data.site_engineer_phone || null,
            site_engineer_email: data.site_engineer_email || null,
            site_engineer_name_2: data.site_engineer_name_2 || null,
            site_engineer_phone_2: data.site_engineer_phone_2 || null,
            site_engineer_email_2: data.site_engineer_email_2 || null,
            contractor_name: data.contractor_name || null,
            contractor_phone: data.contractor_phone || null,
            contractor_email: data.contractor_email || null,
            sub_contractor_name: data.sub_contractor_name || null,
            sub_contractor_phone: data.sub_contractor_phone || null,
            sub_contractor_email: data.sub_contractor_email || null,
            sub_total: Number(data.sub_total) || 0,
            gst_amount: Number(data.gst_amount) || 0,
            grand_total: Number(data.grand_total) || 0,
            terms: Array.isArray(data.terms) ? data.terms : [],
            remarks: data.remarks || null,
            status: 'Issued',
            items: {
              create: lineItems.map((it: any) => {
                const qty = Number(it.quantity);
                const rate = Number(it.rate) || 0;
                const gst = Number(it.gst_percent) || 0;
                const disc = Number(it.discount_percent) || 0;
                const base = qty * rate * (1 - disc / 100);
                return {
                  indent_number: it.indent_number || indentNumber,
                  quotation_number: it.quotation_number || null,
                  product_name: String(it.product_name).trim(),
                  quantity: qty,
                  uom: it.uom || 'Nos',
                  rate,
                  gst_percent: gst,
                  discount_percent: disc,
                  amount: it.amount !== undefined && it.amount !== null ? Number(it.amount) : base + (base * gst) / 100,
                  payment_terms: it.payment_terms || null,
                };
              }),
            },
          },
          include: { items: { orderBy: { id: 'asc' } } },
        });

        if (indent) {
          await tx.pMSIndent.update({ where: { id: indent.id }, data: { stage: 'POCreated', po_required: false } });
        }
        return toPODTO(po);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiError(409, `PO number ${data.po_number} already exists`);
      }
      throw err;
    }
  }
}

export const pmsProcurementService = new PMSProcurementService();
