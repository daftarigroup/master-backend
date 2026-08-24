import { prisma } from '../../../database/prisma';
import { PcReportService } from './pcReport.service';

export class StageResetService {
  private pcReportService: PcReportService;

  constructor() {
    this.pcReportService = new PcReportService();
  }

  /**
   * Reset Lifting Stage:
   * Removes store_in entry, removes linked fullkitting, restores indent lifting status to Pending
   */
  async resetLifting(data: { id?: number; liftNumber?: string; indentNo?: string; productName?: string }) {
    let whereClause: any = {};
    if (data.id) {
      whereClause.id = BigInt(data.id);
    } else if (data.liftNumber) {
      whereClause.lift_number = data.liftNumber;
    } else if (data.indentNo && data.productName) {
      whereClause.indent_no = data.indentNo;
      whereClause.product_name = data.productName;
    } else {
      throw new Error('Missing identifier (id, liftNumber, or indentNo+productName) to reset lifting');
    }

    const storeInRecords = await prisma.storeIn.findMany({ where: whereClause });
    if (!storeInRecords || storeInRecords.length === 0) {
      throw new Error('No Store In / Lifting record found to reset');
    }

    for (const record of storeInRecords) {
      const indentNo = record.indent_no;
      const prodName = record.product_name;
      const liftNo = record.lift_number;

      // 1. Delete matching fullkitting entry if created
      if (indentNo && prodName) {
        await prisma.fullkitting.deleteMany({
          where: {
            indent_number: indentNo,
            product_name: prodName,
          },
        });
      }

      // 2. Delete auto-created payment entries if any
      if (indentNo && prodName) {
        await prisma.payments.deleteMany({
          where: {
            internal_code: indentNo,
            product: prodName,
            payment_form: 'store_in',
          },
        });
      }

      // 3. Delete matching tally_entry if any
      if (indentNo && prodName) {
        await prisma.tallyEntry.deleteMany({
          where: {
            indent_number: indentNo,
            product_name: prodName,
            ...(liftNo ? { lift_number: liftNo } : {}),
          },
        });
      }

      // 4. Delete the store_in record
      await prisma.storeIn.delete({
        where: { id: record.id },
      });

      // 5. Restore matching Indent record
      if (indentNo) {
        const indentWhere: any = { indent_number: indentNo };
        if (prodName) {
          indentWhere.product_name = prodName;
        }

        const existingIndent = await prisma.indent.findFirst({ where: indentWhere });
        if (existingIndent) {
          await prisma.indent.updateMany({
            where: indentWhere,
            data: {
              actual5: null,
              time_delay: null,
              lifting_status: 'Pending',
              pending_lift_qty: existingIndent.approved_quantity || existingIndent.quantity || null,
            },
          });
        }
      }
    }

    // Recalculate KPIs
    await this.pcReportService.recalculateStageKpis('PO WebApp');
    await this.pcReportService.recalculateStageKpis('Material Lifting');
    await this.pcReportService.recalculateStageKpis('Received In Store');

    return { success: true, count: storeInRecords.length };
  }

  /**
   * Reset StoreIn Stage (store_check, hod_check, reject_grn, bill_not_received)
   */
  async resetStoreInStage(id: number, stage: string) {
    const existing = await prisma.storeIn.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existing) {
      throw new Error(`StoreIn record with ID ${id} not found`);
    }

    let updatePayload: any = {};

    if (stage === 'store_check') {
      updatePayload = {
        actual6: null,
        time_delay6: null,
        receiving_status: null,
        received_quantity: null,
        photo_of_product: null,
        damage_order: null,
        quantity_as_per_bill: null,
        remark: null,
        location: null,
        price_as_per_po_check: null,
        challan_no: null,
        challan_image: null,
        receiver_name: null,
        hod_planned: null,
        // Cascade HOD Check
        hod_actual: null,
        hod_status: 'Pending',
        hod_remark: null,
        // Cascade Reject for GRN
        planned7: null,
        actual7: null,
        time_delay7: null,
        status: null,
        bill_copy_attached: null,
        reason: null,
        send_debit_note: null,
        // Cascade Send Debit Note
        planned9: null,
        actual9: null,
        time_delay9: null,
        debit_note_copy: null,
        debit_note_number: null,
      };

      // Clean up auto-created payment / tally_entry if HOD was previously approved
      if (existing.indent_no && existing.product_name) {
        await prisma.payments.deleteMany({
          where: {
            internal_code: existing.indent_no,
            product: existing.product_name,
            payment_form: 'store_in',
          },
        });
        await prisma.tallyEntry.deleteMany({
          where: {
            indent_number: existing.indent_no,
            product_name: existing.product_name,
            ...(existing.lift_number ? { lift_number: existing.lift_number } : {}),
          },
        });
      }
    } else if (stage === 'hod_check') {
      updatePayload = {
        hod_actual: null,
        hod_status: 'Pending',
        hod_remark: null,
        // Cascade Reject for GRN if it was rejected
        planned7: null,
        actual7: null,
        time_delay7: null,
        status: null,
        bill_copy_attached: null,
        reason: null,
        send_debit_note: null,
        // Cascade Send Debit Note
        planned9: null,
        actual9: null,
        time_delay9: null,
        debit_note_copy: null,
        debit_note_number: null,
      };

      // Clean up auto-created payment / tally_entry
      if (existing.indent_no && existing.product_name) {
        await prisma.payments.deleteMany({
          where: {
            internal_code: existing.indent_no,
            product: existing.product_name,
            payment_form: 'store_in',
          },
        });
        await prisma.tallyEntry.deleteMany({
          where: {
            indent_number: existing.indent_no,
            product_name: existing.product_name,
            ...(existing.lift_number ? { lift_number: existing.lift_number } : {}),
          },
        });
      }
    } else if (stage === 'reject_grn') {
      updatePayload = {
        actual7: null,
        time_delay7: null,
        status: null,
        bill_copy_attached: null,
        reason: null,
        send_debit_note: null,
        // Cascade Send Debit Note
        planned9: null,
        actual9: null,
        time_delay9: null,
        debit_note_copy: null,
        debit_note_number: null,
      };
    } else if (stage === 'bill_not_received') {
      updatePayload = {
        actual11: null,
        time_delay: null,
        bill_status: 'Not Received',
        bill_status_new: null,
        bill_image_status: null,
      };
    } else {
      throw new Error(`Invalid stage '${stage}' for StoreIn reset`);
    }

    const updated = await prisma.storeIn.update({
      where: { id: BigInt(id) },
      data: updatePayload,
    });

    // Recalculate KPIs
    await this.pcReportService.recalculateStageKpis('Received In Store');
    await this.pcReportService.recalculateStageKpis('Quality Check In Received Item');
    await this.pcReportService.recalculateStageKpis('Send Debit Note');

    return updated;
  }

  /**
   * Reset Payment Stage:
   * Sets payments.actual = null, payment_done = false, status = 'Pending', and removes payment_history row
   */
  async resetPaymentStage(id: number) {
    const payment = await prisma.payments.findUnique({
      where: { id: BigInt(id) },
    });

    if (!payment) {
      throw new Error(`Payment record with ID ${id} not found`);
    }

    const updated = await prisma.payments.update({
      where: { id: BigInt(id) },
      data: {
        actual: null,
        status: 'Pending',
        status1: null,
        payment_done: false,
      },
    });

    // Clean up payment_history
    if (payment.unique_no) {
      await prisma.paymentHistory.deleteMany({
        where: { unique_number: payment.unique_no },
      });
    } else if (payment.internal_code && payment.product) {
      await prisma.paymentHistory.deleteMany({
        where: {
          indent_no: payment.internal_code,
          product_name: payment.product,
        },
      });
    }

    return updated;
  }

  /**
   * Reset Fullkitting (Freight Payment) Stage
   */
  async resetFullkittingStage(id: number) {
    const existing = await prisma.fullkitting.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existing) {
      throw new Error(`Fullkitting record with ID ${id} not found`);
    }

    const updated = await prisma.fullkitting.update({
      where: { id: BigInt(id) },
      data: {
        actual: null,
        time_delay: null,
        status: null,
        vehicle_number: null,
        from: null,
        to: null,
        material_load_details: null,
        bilty_number: null,
        rate_type: null,
        amount1: null,
        bilty_image: null,
      },
    });

    return updated;
  }

  /**
   * Reset Tally Entry Stage (audit, rectify, reaudit, tally_entry, again_audit)
   */
  async resetTallyEntryStage(id: number, stage: string) {
    const existing = await prisma.tallyEntry.findUnique({
      where: { id: BigInt(id) },
    });

    if (!existing) {
      throw new Error(`TallyEntry record with ID ${id} not found`);
    }

    let updatePayload: any = {};

    if (stage === 'audit' || stage === 'stage1') {
      updatePayload = {
        actual1: null,
        delay1: null,
        status1: null,
        remarks1: null,
        // Cascade stage 2..5
        planned2: null,
        actual2: null,
        delay2: null,
        status2: null,
        remarks2: null,
        planned3: null,
        actual3: null,
        delay3: null,
        status3: null,
        remarks3: null,
        planned4: null,
        actual4: null,
        delay4: null,
        status4: null,
        remarks4: null,
        planned5: null,
        actual5: null,
        delay5: null,
        status5: null,
        remarks5: null,
      };
    } else if (stage === 'rectify' || stage === 'stage2') {
      updatePayload = {
        actual2: null,
        delay2: null,
        status2: null,
        remarks2: null,
        // Cascade stage 3..5
        planned3: null,
        actual3: null,
        delay3: null,
        status3: null,
        remarks3: null,
        planned4: null,
        actual4: null,
        delay4: null,
        status4: null,
        remarks4: null,
        planned5: null,
        actual5: null,
        delay5: null,
        status5: null,
        remarks5: null,
      };
    } else if (stage === 'reaudit' || stage === 'stage3') {
      updatePayload = {
        actual3: null,
        delay3: null,
        status3: null,
        remarks3: null,
        // Cascade stage 4..5
        planned4: null,
        actual4: null,
        delay4: null,
        status4: null,
        remarks4: null,
        planned5: null,
        actual5: null,
        delay5: null,
        status5: null,
        remarks5: null,
      };
    } else if (stage === 'tally_entry' || stage === 'stage4') {
      updatePayload = {
        actual4: null,
        delay4: null,
        status4: null,
        remarks4: null,
        // Cascade stage 5
        planned5: null,
        actual5: null,
        delay5: null,
        status5: null,
        remarks5: null,
      };
    } else if (stage === 'again_audit' || stage === 'stage5') {
      updatePayload = {
        actual5: null,
        delay5: null,
        status5: null,
        remarks5: null,
      };
    } else {
      throw new Error(`Invalid stage '${stage}' for TallyEntry reset`);
    }

    const updated = await prisma.tallyEntry.update({
      where: { id: BigInt(id) },
      data: updatePayload,
    });

    // Recalculate Tally KPIs
    await this.pcReportService.recalculateStageKpis('Audit Data');
    await this.pcReportService.recalculateStageKpis('Rectify the mistake');
    await this.pcReportService.recalculateStageKpis('Reaudit Data');
    await this.pcReportService.recalculateStageKpis('Take Entry By Tally');
    await this.pcReportService.recalculateStageKpis('Again Audit');

    return updated;
  }
}
