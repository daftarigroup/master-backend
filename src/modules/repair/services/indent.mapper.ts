import { RepairIndentStatus, Priority } from '@prisma/client';
import { dateToISO, dateToISODate, decimalToNumber } from './mapUtils';

const STATUS_TO_FRONTEND: Record<RepairIndentStatus, string> = {
  PENDING: 'Pending',
  ASSIGNED: 'Assigned',
  SENT_FOR_REPAIR: 'Sent for Repair',
  STORE_IN: 'Store In',
  COMPLETED: 'Completed',
  PAYMENT_DONE: 'Payment Done',
};
const STATUS_FROM_FRONTEND: Record<string, RepairIndentStatus> = {
  Pending: 'PENDING',
  Assigned: 'ASSIGNED',
  'Sent for Repair': 'SENT_FOR_REPAIR',
  'Store In': 'STORE_IN',
  Completed: 'COMPLETED',
  'Payment Done': 'PAYMENT_DONE',
};

const PRIORITY_TO_FRONTEND: Record<Priority, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', CRITICAL: 'High' };
const PRIORITY_FROM_FRONTEND: Record<string, Priority> = { Low: 'LOW', Medium: 'MEDIUM', High: 'HIGH' };

// Reconstructs the frontend's single conflated `approvalStatus` field
// ('Pending'|'Approved'|'Rejected'|'Inhouse'|'Outhouse') from the two properly
// normalized DB columns (`approvalStatus` + `routingType`) — see architecture doc
// §4/§5 and research finding on RepairIndent.approvalStatus's original overload.
function frontendApprovalStatus(row: any): string {
  if (row.approvalStatus === 'REJECTED') return 'Rejected';
  if (row.approvalStatus === 'PENDING') return 'Pending';
  return row.routingType === 'INHOUSE' ? 'Inhouse' : 'Outhouse';
}

export const indentMapper = {
  toDTO(row: any) {
    const outhouse = row.outhouseRepair;
    return {
      id: row.id,
      indentNumber: row.indentNumber ?? '',
      firmId: row.firmId ? String(row.firmId) : (row.machine?.firmId ? String(row.machine.firmId) : null),
      firmName: row.firm?.firm_name ?? row.machine?.firm?.firm_name ?? '',
      machineName: row.machine?.name ?? '',
      machineSerialNo: row.machine?.serialNumber ?? '',
      doerName: row.doer?.name || row.doer?.user_name || '',
      department: row.department?.name ?? '',
      machinePartName: row.machinePart?.name ?? '',
      problem: row.problem,
      priority: PRIORITY_TO_FRONTEND[row.priority as Priority] ?? 'Medium',
      expectedDeliveryDays: row.expectedDeliveryDays ?? 3,
      location: row.location ?? '',
      taskStatus: STATUS_TO_FRONTEND[row.status as RepairIndentStatus] ?? 'Pending',
      image: row.image ?? undefined,
      remarks: row.remarks ?? '',
      soundOfMachine: row.soundOfMachine ?? undefined,
      temperature: row.temperature ?? undefined,
      maintenanceCost: row.maintenanceCost !== null ? decimalToNumber(row.maintenanceCost) : undefined,
      approvalStatus: frontendApprovalStatus(row),
      approvedAt: dateToISODate(row.approvedAt) ?? undefined,
      createdAt: dateToISODate(row.createdAt),
      updatedAt: dateToISODate(row.updatedAt),
      vendorName: row.vendor?.name ?? outhouse?.offers?.find((o: any) => o.isApproved)?.vendor?.name ?? undefined,
      vendorPhone: row.vendor?.mobileNumber ?? undefined,
      techAssignment: row.technician
        ? {
            technicianId: row.technician.id,
            technicianName: row.technician.name,
            assignedDate: dateToISODate(row.technicianAssignedAt) ?? '',
            workNotes: row.technicianWorkNotes ?? undefined,
          }
        : undefined,
      paymentDetails: outhouse?.payment
        ? {
            finalPaymentAmount: decimalToNumber(outhouse.payment.finalPaymentAmount),
            paidAt: dateToISODate(outhouse.payment.paidAt) ?? undefined,
          }
        : undefined,
      storeInDetails: outhouse?.receiving
        ? {
            toBePaidAmount: decimalToNumber(outhouse.receiving.toBePaidAmount),
            receivedAt: dateToISODate(outhouse.receiving.receivedAt) ?? undefined,
          }
        : undefined,
      // Superset fields from repairSystemApi.ts#RBIndent (the richer real API-layer
      // shape) — included so components reading either the plain mock shape or the
      // richer one get what they expect.
      workUpdates: [],
      inspection: outhouse?.receiving
        ? {
            inspectedBy: outhouse.receiving.inspectedByName || outhouse.receiving.inspectedBy?.name,
            result: outhouse.receiving.inspectionRemarks || outhouse.receiving.inspectionResult,
          }
        : undefined,
      outhouseRepair: outhouse
        ? {
            id: outhouse.id,
            indentId: row.id,
            vendorType: row.routingType === 'OUTHOUSE' ? 'Outhouse' : undefined,
            vendorRemarks: outhouse.vendorRemarks ?? undefined,
            vendorAssignedAt: dateToISO(outhouse.vendorAssignedAt) ?? undefined,
            rateApprovedAt: dateToISO(outhouse.rateApprovedAt) ?? undefined,
            transporterName: outhouse.dispatch?.transporterName ?? undefined,
            vehicleNo: outhouse.dispatch?.vehicleNo ?? undefined,
            driverName: outhouse.dispatch?.driverName ?? undefined,
            driverContact: outhouse.dispatch?.driverContact ?? undefined,
            transportationCharges: outhouse.dispatch ? decimalToNumber(outhouse.dispatch.transportationCharges) : undefined,
            weighmentSlipNo: outhouse.dispatch?.weighmentSlipNo ?? undefined,
            transportImage: outhouse.dispatch?.transportImage ?? undefined,
            sentPaymentType: outhouse.dispatch?.sentPaymentType ?? undefined,
            sentPaymentAmount: outhouse.dispatch ? decimalToNumber(outhouse.dispatch.sentPaymentAmount) : undefined,
            sentAt: dateToISO(outhouse.dispatch?.sentAt) ?? undefined,
            expectedReturnDate: dateToISO(outhouse.dispatch?.expectedReturnDate) ?? undefined,
            inspectedBy: outhouse.receiving?.inspectedByName || outhouse.receiving?.inspectedBy?.name || undefined,
            inspectionResult: outhouse.receiving?.inspectionRemarks || outhouse.receiving?.inspectionResult || undefined,
            returnTransporterName: outhouse.receiving?.returnTransporterName ?? undefined,
            returnTransportAmount: outhouse.receiving ? decimalToNumber(outhouse.receiving.returnTransportAmount) : undefined,
            billImage: outhouse.receiving?.billImage ?? undefined,
            billNo: outhouse.receiving?.billNo ?? undefined,
            typeOfBill: outhouse.receiving?.typeOfBill ?? undefined,
            totalBillAmount: outhouse.receiving ? decimalToNumber(outhouse.receiving.totalBillAmount) : undefined,
            toBePaidAmount: outhouse.receiving ? decimalToNumber(outhouse.receiving.toBePaidAmount) : undefined,
            receivedAt: dateToISO(outhouse.receiving?.receivedAt) ?? undefined,
            billMatch: outhouse.payment?.billMatch !== undefined ? String(outhouse.payment?.billMatch) : undefined,
            billStatus: outhouse.payment?.billStatus ?? undefined,
            finalPaymentAmount: outhouse.payment ? decimalToNumber(outhouse.payment.finalPaymentAmount) : undefined,
            paidAt: dateToISO(outhouse.payment?.paidAt) ?? undefined,
            offers: (outhouse.offers ?? []).map((o: any) => ({
              id: o.id,
              outhouseId: outhouse.id,
              vendorId: o.vendorId,
              vendorName: o.vendor?.name,
              vendor: o.vendor ? { id: o.vendor.id, name: o.vendor.name } : undefined,
              rate: decimalToNumber(o.rate),
              paymentTerm: o.paymentTerm ?? undefined,
              isApproved: o.isApproved,
              createdAt: dateToISO(o.createdAt),
              updatedAt: dateToISO(o.updatedAt),
            })),
          }
        : undefined,
      outhouseOffers: (outhouse?.offers ?? []).map((o: any) => ({
        id: o.id,
        outhouseId: outhouse.id,
        vendorId: o.vendorId,
        vendorName: o.vendor?.name,
        vendor: o.vendor ? { id: o.vendor.id, name: o.vendor.name } : undefined,
        rate: decimalToNumber(o.rate),
        paymentTerm: o.paymentTerm ?? undefined,
        isApproved: o.isApproved,
        createdAt: dateToISO(o.createdAt),
        updatedAt: dateToISO(o.updatedAt),
      })),
      tenant: null,
    };
  },

  statusFromFrontend(taskStatus: string): RepairIndentStatus | undefined {
    return STATUS_FROM_FRONTEND[taskStatus];
  },
  priorityFromFrontend(priority: string | undefined): Priority | undefined {
    return priority ? PRIORITY_FROM_FRONTEND[priority] : undefined;
  },
};
