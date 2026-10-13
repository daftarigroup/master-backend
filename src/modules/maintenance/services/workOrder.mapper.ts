import { dateToISO, dateToISODate, decimalToNumber, userDTO } from './mapUtils';
import { priorityToNumber } from './priority';
import { summarizeParts } from '../lib/partsSummary';

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
      // task assignment: Assigned To does the work, Responsible Person is accountable and approves
      assignedToId: row.currentAssigneeUserId ? String(row.currentAssigneeUserId) : null,
      responsibleId: row.responsibleId ? String(row.responsibleId) : null,
      responsible: userDTO(row.responsible),
      serviceMode: row.serviceMode ?? 'IN_HOUSE',
      // Phases 5 / 6: in-house "material required?" (null = not decided) and the Store parts the repair waits for
      materialRequired: row.materialRequired ?? null,
      parts: row.partRequirements ? summarizeParts(row.partRequirements) : null,
      scheduleId: row.scheduleId ?? null,
      scheduleName: row.schedule?.name ?? null,
      readingAtService: row.readingAtService !== null && row.readingAtService !== undefined ? decimalToNumber(row.readingAtService) : null,
      // estimate / actual split: removed from the response for users without cost access (see stripWorkOrderCost)
      costDetail: {
        estPartsCost: row.estPartsCost !== null && row.estPartsCost !== undefined ? decimalToNumber(row.estPartsCost) : null,
        estLabourCost: row.estLabourCost !== null && row.estLabourCost !== undefined ? decimalToNumber(row.estLabourCost) : null,
        actualPartsCost: row.actualPartsCost !== null && row.actualPartsCost !== undefined ? decimalToNumber(row.actualPartsCost) : null,
        actualLabourCost: row.actualLabourCost !== null && row.actualLabourCost !== undefined ? decimalToNumber(row.actualLabourCost) : null,
      },
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
      // A work order owns its content now; older rows were backfilled from their plan.
      title: row.title ?? row.plan?.title ?? null,
      description: row.description ?? row.plan?.description ?? null,
      documentUrl: row.documentUrl ?? row.plan?.documentUrl ?? null,
      activityTypeId: row.activityTypeId ?? row.plan?.activityTypeId ?? null,
      activityType: row.activityType
        ? { id: row.activityType.id, name: row.activityType.name, code: row.activityType.code }
        : row.plan?.activityType
          ? { id: row.plan.activityType.id, name: row.plan.activityType.name, code: row.plan.activityType.code }
          : null,
      requestedBy: userDTO(row.requestedBy ?? row.plan?.createdBy),
      // Simplified out-source track: To send -> Sent -> Received -> Paid (null when the job is not outsourced).
      outsource: row.outsourceStatus
        ? {
            status: row.outsourceStatus,
            vendorId: row.vendorId ?? null,
            vendorName: row.vendor?.name ?? null,
            sentAt: dateToISO(row.sentAt),
            receivedAt: dateToISO(row.receivedAt),
            paidAt: dateToISO(row.paidAt),
            billNo: row.billNo ?? null,
            billAmount: row.cost !== null && row.cost !== undefined ? decimalToNumber(row.cost) : null,
            billUrl: row.billUrl ?? null,
          }
        : null,
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
            assignment: row.machine.assignments?.[0]
              ? {
                  id: row.machine.assignments[0].id,
                  firmId: String(row.machine.assignments[0].firmId),
                  firmName: row.machine.assignments[0].firm?.firm_name,
                }
              : undefined,
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
        : row.title
          ? // a work order created without a plan: present its own content in the shape the current screens read
            {
              id: null,
              planCode: undefined,
              title: row.title,
              activityType: row.activityType ? { id: row.activityType.id, name: row.activityType.name, code: row.activityType.code } : null,
              frequency: null, // not 'ONE_TIME': the current screens offer "Edit plan" for that, and there is no plan here
              description: row.description,
              creationType: 'MANUAL',
              documentUrl: row.documentUrl,
              documentMediaId: null,
              machinePart: row.machinePart,
              createdBy: userDTO(row.requestedBy),
            }
          : null,
      currentAssignee: userDTO(row.currentAssignee ?? row.responsible),
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
        unitCost: p.unitCost !== null && p.unitCost !== undefined ? decimalToNumber(p.unitCost) : null,
        machinePartId: p.machinePartId ?? null,
      })),
      checklistItems: (row.checklistItems ?? []).map((c: any) => ({ id: c.id, text: c.text, done: c.state ? c.state === 'DONE' : c.done, state: c.state ?? (c.done ? 'DONE' : 'PENDING'), note: c.note ?? null, doneAt: dateToISO(c.doneAt), photoUrl: c.photoUrl ?? null })),
      tenant: null,
    };
  },
};
