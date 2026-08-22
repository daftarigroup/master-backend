import { IndentRepository } from '../repositories/indent.repository';
import { IndentRecordDTO } from '../types/indent.types';
import { DelayCalculatorService } from './delayCalculator.service';
import { SchedulePlannerService } from './schedulePlanner.service';
import { InventoryStockService } from './inventoryStock.service';
import { PcReportService } from './pcReport.service';

export class IndentService {
  private repository: IndentRepository;
  private inventoryService: InventoryStockService;
  private pcReportService: PcReportService;

  constructor() {
    this.repository = new IndentRepository();
    this.inventoryService = new InventoryStockService();
    this.pcReportService = new PcReportService();
  }

  async getAllIndents(permittedFirms?: string[]): Promise<IndentRecordDTO[]> {
    const rawData = await this.repository.findAll(permittedFirms);

    return rawData.map((r: any) => ({
      id: Number(r.id),
      indent_number: r.indent_number || '',
      indenter_name: r.indenter_name || '',
      product_name: r.product_name || '',
      quantity: Number(r.quantity) || 0,
      uom: r.uom || '',
      attachment: r.attachment || '',
      specifications: r.specifications || '',
      area_of_use: r.area_of_use || '',
      vendor_type: r.vendor_type || 'Pending',
      indent_status: r.indent_status || '',
      indent_type: r.indent_type || '',
      no_day: Number(r.no_day) || 0,
      planned1: r.planned1 ? new Date(r.planned1).toISOString() : '',
      actual1: r.actual1 ? new Date(r.actual1).toISOString() : '',
      firm_name: r.firm_name || '',
      firm_id: r.firm_id ? Number(r.firm_id) : undefined,
      firmName: r.firm_name || '',
      firmNameMatch: r.firm_name || '',
      approved_quantity: Number(r.approved_quantity) || 0,
      timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : '',
      price: Number(r.price) || 0,
      total_rate: Number(r.total_rate) || 0,
      indent_approved_by: r.indent_approved_by || '',
      approved_date: r.approved_date || '',
      planned2: r.planned2 ? new Date(r.planned2).toISOString() : '',
      actual2: r.actual2 ? new Date(r.actual2).toISOString() : '',
      vendor_name: r.vendor_name || '',
      negotiated_rate: Number(r.negotiated_rate) || 0,
      planned3: r.planned3 ? new Date(r.planned3).toISOString() : '',
      actual3: r.actual3 ? new Date(r.actual3).toISOString() : '',
      attachment3: r.attachment3 || '',
      comparative_analysis: r.comparative_analysis || '',
      planned4: r.planned4 ? new Date(r.planned4).toISOString() : '',
      actual4: r.actual4 ? new Date(r.actual4).toISOString() : '',
      po_number: r.po_number || '',
      po_date: r.po_date || '',
      po_copy: r.po_copy || '',
      planned5: r.planned5 ? new Date(r.planned5).toISOString() : '',
      actual5: r.actual5 ? new Date(r.actual5).toISOString() : '',
      transportation_include: r.transportation_include || '',
      tax_extra: r.tax_extra || '',
      credit_days: Number(r.credit_days) || 0,
      remarks5: r.remarks5 || '',
      status: r.status || '',
      lifting_status: r.lifting_status || '',
      po_qty: Number(r.po_qty) || 0,
      received_quantity: Number(r.received_qty) || 0,
      pending_qty: Number(r.pending_qty) || 0,
      approved_vendor_name: r.approved_vendor_name || '',
      pending_po_qty: r.pending_po_qty != null && r.pending_po_qty !== '' ? Number(r.pending_po_qty) : null,
      pending_lift_qty: r.pending_lift_qty != null && r.pending_lift_qty !== '' ? Number(r.pending_lift_qty) : null,
      po_requred: r.po_requred || '',
      vendor1_rank: r.vendor1_rank || '',
      vendor2_rank: r.vendor2_rank || '',
      vendor3_rank: r.vendor3_rank || '',
      indent_url: r.indent_url || '',
      expected_req_date: r.expected_req_date ? new Date(r.expected_req_date).toISOString() : '',
      group_head: r.group_head || '',
      min_stock_qty: Number(r.min_stock_qty) || 0,
    }));
  }

  async updateApproval(id: number, data: any) {
    const isReject = data.vendor_type === 'Reject' || data.status === 'Rejected';
    const updateData: any = {
      actual1: data.actual1 ? new Date(data.actual1) : undefined,
      vendor_type: data.vendor_type,
      approved_quantity: isReject ? '0' : (data.approved_quantity !== undefined ? String(data.approved_quantity) : undefined),
      planned2: isReject ? null : (data.planned2 ? new Date(data.planned2) : undefined),
      status: isReject ? 'Rejected' : (data.status || 'Completed'),
      indent_url: data.indent_url,
    };

    if (isReject) {
      // Clear any downstream stage data so further stages never receive this rejected indent
      updateData.actual2 = null;
      updateData.planned3 = null;
      updateData.actual3 = null;
      updateData.planned4 = null;
      updateData.actual4 = null;
      updateData.planned5 = null;
      updateData.actual5 = null;
      updateData.po_number = null;
      updateData.po_copy = null;
      updateData.approved_vendor_name = null;
    }

    if (data.actual1 && data.planned1) {
      updateData.time_delay1 = DelayCalculatorService.calculateDelay(data.actual1, data.planned1);
    }

    const updated = await this.repository.updateById(id, updateData);
    if (updated?.product_name) {
      await this.inventoryService.syncInventoryItemAggregations(updated.product_name);
    }
    await this.pcReportService.recalculateStageKpis('Should Need Offer Or Regular');
    await this.pcReportService.recalculateStageKpis('Reguler Or Need Offer Rate Update');
    return updated;
  }

  async updateSpecifications(id: number, specifications: string) {
    return this.repository.updateById(id, { specifications });
  }

  async updateHistoryFields(id: number, data: any) {
    const updateData: any = {};
    if (data.approved_quantity !== undefined) updateData.approved_quantity = String(data.approved_quantity);
    if (data.uom !== undefined) updateData.uom = data.uom;
    if (data.vendor_type !== undefined) updateData.vendor_type = data.vendor_type;

    return this.repository.updateById(id, updateData);
  }

  async updateVendorSelection(indentNumber: string, data: any) {
    const planned3Date = data.planned3
      ? new Date(data.planned3)
      : SchedulePlannerService.skipSunday(new Date());

    const updateData: any = {
      actual2: data.actual2 ? new Date(data.actual2) : undefined,
      vendor_name1: data.vendor_name,
      rate1: data.negotiated_rate !== undefined ? String(data.negotiated_rate) : undefined,
      planned3: planned3Date,
    };

    if (data.actual2 && data.planned2) {
      updateData.time_delay2 = DelayCalculatorService.calculateDelay(data.actual2, data.planned2);
    }

    const updated = await this.repository.updateByIndentNumber(indentNumber, updateData);
    await this.pcReportService.recalculateStageKpis('Reguler Or Need Offer Rate Update');
    return updated;
  }

  async updateHODApproval(indentNumber: string, data: any) {
    const vendorType = data.vendor_type || 'Three Party';
    const planned4Date = data.planned4
      ? new Date(data.planned4)
      : SchedulePlannerService.generatePlanned4(vendorType, data.actual2, data.actual3);

    const updateData: any = {
      actual3: data.actual3 ? new Date(data.actual3) : undefined,
      comparison_sheet: data.comparative_analysis,
      attachment: data.attachment3,
      planned4: planned4Date,
    };

    if (data.actual3 && data.planned3) {
      updateData.time_delay3 = DelayCalculatorService.calculateDelay(data.actual3, data.planned3);
    }

    const updated = await this.repository.updateByIndentNumber(indentNumber, updateData);
    await this.pcReportService.recalculateStageKpis('Approval And Rejection For Purchase');
    return updated;
  }

  async updatePOCreation(indentNumber: string, data: any) {
    const planned5Date = data.planned5
      ? new Date(data.planned5)
      : (data.actual4 ? SchedulePlannerService.skipSunday(new Date(data.actual4)) : null);

    const updateData: any = {
      actual4: data.actual4 ? new Date(data.actual4) : undefined,
      po_number: data.po_number,
      po_copy: data.po_copy,
      planned5: planned5Date,
    };

    if (data.actual4 && data.planned4) {
      updateData.time_delay4 = DelayCalculatorService.calculateDelay(data.actual4, data.planned4);
    }

    const updated = await this.repository.updateByIndentNumber(indentNumber, updateData);
    await this.pcReportService.recalculateStageKpis('PO WebApp');
    return updated;
  }

  async updatePaymentTerms(indentNumber: string, data: any) {
    const planned7Date = SchedulePlannerService.generatePlanned7(data.actual5, data.payment_term);

    const updateData: any = {
      actual5: data.actual5 ? new Date(data.actual5) : undefined,
      payment_term: data.payment_term,
      planned7: planned7Date,
    };

    if (data.actual5 && data.planned5) {
      updateData.time_delay = DelayCalculatorService.calculateDelay(data.actual5, data.planned5);
    }

    const updated = await this.repository.updateByIndentNumber(indentNumber, updateData);
    await this.pcReportService.recalculateStageKpis('Material Lifting');
    return updated;
  }

  async updateStoreOutApproval(indentNumber: string, data: any) {
    const updated = await this.repository.updateByIndentNumber(indentNumber, {
      indent_approved_by: data.approved_by,
      approved_date: data.approved_date,
      approved_quantity: data.approved_quantity !== undefined ? String(data.approved_quantity) : undefined,
      indent_status: data.status,
    });
    if (updated?.product_name) {
      await this.inventoryService.syncInventoryItemAggregations(updated.product_name);
    }
    await this.pcReportService.recalculateStageKpis('Store Out Approval');
    return updated;
  }

  /**
   * Delete complete indent record by ID
   */
  async deleteIndentRecord(id: number) {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Indent with ID ${id} not found`);
    }

    const deleted = await this.repository.deleteById(id);

    if (deleted?.product_name) {
      await this.inventoryService.syncInventoryItemAggregations(deleted.product_name);
    }

    // Recalculate all affected Indent stage KPIs
    await this.pcReportService.recalculateStageKpis('Should Need Offer Or Regular');
    await this.pcReportService.recalculateStageKpis('Reguler Or Need Offer Rate Update');
    await this.pcReportService.recalculateStageKpis('Approval And Rejection For Purchase');
    await this.pcReportService.recalculateStageKpis('PO WebApp');
    await this.pcReportService.recalculateStageKpis('Material Lifting');

    return deleted;
  }

  /**
   * Reset specific indent stage and cascade reset all concurrent downstream stages
   */
  async resetIndentStage(id: number, stage: string) {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Indent with ID ${id} not found`);
    }

    let updatePayload: any = {};

    if (stage === 'approval') {
      // Reset Stage 2 (Indent Approval) + Stages 3, 4, 5
      updatePayload = {
        actual1: null,
        time_delay1: null,
        vendor_type: 'Pending',
        approved_quantity: null,
        indent_approved_by: null,
        approved_date: null,
        status: 'Pending',
        planned2: null,
        // Stage 3 fields
        actual2: null,
        time_delay2: null,
        vendor_name1: null,
        select_rate_type1: null,
        rate1: null,
        with_tax_or_not1: null,
        tax_value1: null,
        payment_term1: null,
        whatsapp_number1: null,
        email_id1: null,
        vendor_name2: null,
        select_rate_type2: null,
        rate2: null,
        with_tax_or_not2: null,
        tax_value2: null,
        payment_term2: null,
        whatsapp_number2: null,
        email_id2: null,
        vendor_name3: null,
        select_rate_type3: null,
        rate3: null,
        with_tax_or_not3: null,
        tax_value3: null,
        payment_term3: null,
        whatsapp_number3: null,
        email_id3: null,
        product_code: null,
        comparison_sheet: null,
        advance_percent1: null,
        advance_percent2: null,
        advance_percent3: null,
        quotation_no1: '',
        quotation_date1: '',
        quotation_no2: '',
        quotation_date2: '',
        quotation_no3: '',
        quotation_date3: '',
        delivery_time1: null,
        delivery_time2: null,
        delivery_time3: null,
        make1: null,
        make2: null,
        make3: null,
        po_requred: null,
        planned3: null,
        // Stage 4 fields
        actual3: null,
        time_delay3: null,
        vendor1_rank: null,
        vendor2_rank: null,
        vendor3_rank: null,
        planned4: null,
        // Stage 5 fields
        actual4: null,
        time_delay4: null,
        approved_vendor_name: null,
        approved_rate: null,
        with_tax_or_not4: null,
        tax_value4: null,
        approved_payment_term: null,
        approved_advance_percent: null,
        approved_quotation_no: '',
        approved_quotation_date: '',
        planned5: null,
        po_number: null,
        po_copy: null,
        payment_term: null,
        actual5: null,
        time_delay: null,
      };
    } else if (stage === 'vendor_rate') {
      // Reset Stage 3 (Vendor Rate Update) + Stages 4, 5 (Stages 1 and 2 remain intact)
      updatePayload = {
        actual2: null,
        time_delay2: null,
        vendor_name1: null,
        select_rate_type1: null,
        rate1: null,
        with_tax_or_not1: null,
        tax_value1: null,
        payment_term1: null,
        whatsapp_number1: null,
        email_id1: null,
        vendor_name2: null,
        select_rate_type2: null,
        rate2: null,
        with_tax_or_not2: null,
        tax_value2: null,
        payment_term2: null,
        whatsapp_number2: null,
        email_id2: null,
        vendor_name3: null,
        select_rate_type3: null,
        rate3: null,
        with_tax_or_not3: null,
        tax_value3: null,
        payment_term3: null,
        whatsapp_number3: null,
        email_id3: null,
        product_code: null,
        comparison_sheet: null,
        advance_percent1: null,
        advance_percent2: null,
        advance_percent3: null,
        quotation_no1: '',
        quotation_date1: '',
        quotation_no2: '',
        quotation_date2: '',
        quotation_no3: '',
        quotation_date3: '',
        delivery_time1: null,
        delivery_time2: null,
        delivery_time3: null,
        make1: null,
        make2: null,
        make3: null,
        po_requred: null,
        planned3: null,
        // Stage 4 fields
        actual3: null,
        time_delay3: null,
        vendor1_rank: null,
        vendor2_rank: null,
        vendor3_rank: null,
        planned4: null,
        // Stage 5 fields
        actual4: null,
        time_delay4: null,
        approved_vendor_name: null,
        approved_rate: null,
        with_tax_or_not4: null,
        tax_value4: null,
        approved_payment_term: null,
        approved_advance_percent: null,
        approved_quotation_no: '',
        approved_quotation_date: '',
        planned5: null,
        po_number: null,
        po_copy: null,
        payment_term: null,
        actual5: null,
        time_delay: null,
      };
    } else if (stage === 'technical_approval') {
      // Reset Stage 4 (Technical Approval) + Stage 5 (Stages 1, 2, 3 remain intact)
      updatePayload = {
        actual3: null,
        time_delay3: null,
        vendor1_rank: null,
        vendor2_rank: null,
        vendor3_rank: null,
        planned4: null,
        // Stage 5 fields
        actual4: null,
        time_delay4: null,
        approved_vendor_name: null,
        approved_rate: null,
        with_tax_or_not4: null,
        tax_value4: null,
        approved_payment_term: null,
        approved_advance_percent: null,
        approved_quotation_no: '',
        approved_quotation_date: '',
        planned5: null,
        po_number: null,
        po_copy: null,
        payment_term: null,
        actual5: null,
        time_delay: null,
      };
    } else if (stage === 'management_approval') {
      // Reset Stage 5 (Management Approval) (Stages 1, 2, 3, 4 remain intact)
      updatePayload = {
        actual4: null,
        time_delay4: null,
        approved_vendor_name: null,
        approved_rate: null,
        with_tax_or_not4: null,
        tax_value4: null,
        approved_payment_term: null,
        approved_advance_percent: null,
        approved_quotation_no: '',
        approved_quotation_date: '',
        planned5: null,
        po_number: null,
        po_copy: null,
        payment_term: null,
        actual5: null,
        time_delay: null,
      };
    } else {
      throw new Error(`Invalid stage name '${stage}' for indent reset`);
    }

    const updated = await this.repository.updateById(id, updatePayload);

    // Recalculate KPIs for affected stages
    await this.pcReportService.recalculateStageKpis('Should Need Offer Or Regular');
    await this.pcReportService.recalculateStageKpis('Reguler Or Need Offer Rate Update');
    await this.pcReportService.recalculateStageKpis('Approval And Rejection For Purchase');
    await this.pcReportService.recalculateStageKpis('PO WebApp');
    await this.pcReportService.recalculateStageKpis('Material Lifting');

    return updated;
  }
}

