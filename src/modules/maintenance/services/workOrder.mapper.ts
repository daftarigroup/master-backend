import { dateToISO, dateToISODate, decimalToNumber, userDTO } from './mapUtils';
import { priorityToNumber } from './priority';

// Canonical merge of the three drifted WorkOrder shapes found in the frontend
// (unique_task/server/api/workordersApi.ts, delegation/types/types.ts,
// machines/types/types.ts#MaintenanceWorkOrder) — see
// ASSET_MAINTENANCE_REPAIR_SCHEMA_ARCHITECTURE.md. Every field any of the three
// declared is present here so no consuming feature loses data by switching to
// this one real endpoint.
export const workOrderMapper = {
  toDTO(row: any) {
    const latestApproval = row.approvalRequests?.[0] ?? null;
    return {
      id: row.id,
      workOrderCode: row.workOrderCode ?? undefined,
      tenantId: row.firmId ? String(row.firmId) : '1',
      planId: row.planId,
      machineId: row.machineId,
      machinePartId: row.machinePartId,
      breakdownReportId: row.breakdownReportId,
      currentAssigneeId: row.currentAssigneeUserId ? String(row.currentAssigneeUserId) : null,
      type: row.type,
      status: row.status,
      priority: priorityToNumber(row.priority),
      scheduledDate: dateToISODate(row.scheduledDate),
      actualDueDate: dateToISO(row.actualDueDate),
      wasShifted: row.wasShifted,
      startedAt: dateToISO(row.startedAt),
      completedAt: dateToISO(row.completedAt),
      skipReason: row.skipReason,
      cancelReason: row.cancelReason,
      completionNote: row.completionNote,
      actualMinutesTaken: row.actualMinutesTaken,
      cost: row.cost !== null && row.cost !== undefined ? decimalToNumber(row.cost) : null,
      photoUrl: row.photoUrl ?? undefined,
      billUrl: row.billUrl ?? undefined,
      typeOfWork: row.typeOfWork ?? undefined,
      slaBreach: row.slaBreach,
      escalationLevel: row.escalationLevel,
      createdAt: dateToISO(row.createdAt),
      updatedAt: dateToISO(row.updatedAt),
      machine: row.machine
        ? {
            id: row.machine.id,
            name: row.machine.name,
            assetCode: row.machine.assetCode,
            firmId: row.machine.firmId ? String(row.machine.firmId) : undefined,
            firmName: row.machine.firm?.firm_name,
            firm: row.machine.firm ? { id: String(row.machine.firm.id), name: row.machine.firm.firm_name } : undefined,
          }
        : null,
      machinePart: row.machinePart,
      plan: row.plan
        ? {
            id: row.plan.id,
            planCode: row.plan.planCode ?? undefined,
            title: row.plan.title,
            activityType: row.plan.activityType
              ? { id: row.plan.activityType.id, name: row.plan.activityType.name, code: row.plan.activityType.code }
              : null,
            frequency: row.plan.frequency,
            description: row.plan.description,
            creationType: 'MANUAL',
            documentUrl: row.plan.documentUrl,
            documentMediaId: null,
            machinePart: row.plan.machinePart,
            createdBy: userDTO(row.plan.createdBy),
          }
        : null,
      currentAssignee: userDTO(row.currentAssignee),
      completedBy: userDTO(row.completedBy),
      transfers: (row.transfers ?? []).map((t: any) => ({
        fromUser: t.fromUser ? { name: t.fromUser.name } : null,
        toUser: t.toUser ? { name: t.toUser.name } : null,
      })),
      approvalRequest: latestApproval
        ? {
            id: latestApproval.id,
            status: latestApproval.status,
            requestedAt: dateToISO(latestApproval.requestedAt),
            reviewedAt: dateToISO(latestApproval.reviewedAt),
            reviewNote: latestApproval.reviewNote,
            reviewedBy: latestApproval.reviewedBy ? { id: String(latestApproval.reviewedBy.id), name: latestApproval.reviewedBy.name } : null,
            reviewer: latestApproval.reviewedBy ? { id: String(latestApproval.reviewedBy.id), name: latestApproval.reviewedBy.name } : null,
            submittedBy: latestApproval.submittedBy ? { id: String(latestApproval.submittedBy.id), name: latestApproval.submittedBy.name } : null,
            submissionNote: latestApproval.submissionNote,
          }
        : null,
      statusLogs: (row.statusLogs ?? []).map((s: any) => ({
        id: s.id,
        fromStatus: s.fromStatus,
        toStatus: s.toStatus,
        note: s.note,
        sendMachine: null,
        createdAt: dateToISO(s.createdAt),
        changedBy: s.changedBy ? { id: String(s.changedBy.id), name: s.changedBy.name } : null,
      })),
      // Structured replacement for the frontend's untyped `checklistResponses`
      // JSON blob — `replacements`/`repairParts` are real child tables here.
      checklistResponses: {
        replacements: (row.replacementParts ?? []).map((r: any) => ({ name: r.name, quantity: r.quantity, cost: decimalToNumber(r.cost) })),
        repairProcess: {
          photoUrl: row.photoUrl ?? undefined,
          billUrl: row.billUrl ?? undefined,
          typeOfWork: row.typeOfWork ?? undefined,
          maintenanceCost: row.cost !== null && row.cost !== undefined ? decimalToNumber(row.cost) : undefined,
          billAmount: row.cost !== null && row.cost !== undefined ? decimalToNumber(row.cost) : undefined,
          workDone: row.completionNote ?? undefined,
          remarks: row.completionNote ?? undefined,
          vendorName: (row.repairParts ?? []).map((p: any) => p.vendorName).filter(Boolean)[0] ?? undefined,
          parts: (row.repairParts ?? []).map((p: any) => ({
            partId: p.id,
            partName: p.partName,
            quantity: p.quantity,
            vendorName: p.vendorName ?? undefined,
            warrantyFromDate: dateToISODate(p.warrantyFromDate),
            warrantyToDate: dateToISODate(p.warrantyToDate),
          })),
        },
      },
      repairParts: (row.repairParts ?? []).map((p: any) => ({
        partId: p.id,
        partName: p.partName,
        quantity: p.quantity,
        vendorName: p.vendorName,
        warrantyFromDate: dateToISODate(p.warrantyFromDate),
        warrantyToDate: dateToISODate(p.warrantyToDate),
      })),
      checklistItems: (row.checklistItems ?? []).map((c: any) => ({ id: c.id, text: c.text, done: c.done })),
      tenant: null,
    };
  },
};
