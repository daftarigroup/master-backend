import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { dateToISO, decimalToNumberOrNull, parsePagination, paginationMeta, userDTO } from './mapUtils';
import { workOrderService } from './workOrder.service';

const INCLUDE = {
  machine: { select: { id: true, name: true, assetCode: true, firmId: true, firm: { select: { id: true, firm_name: true } } } },
  reportedBy: { select: { id: true, name: true, user_name: true, employee: { select: { email: true } } } },
  assignedTo: { select: { id: true, name: true, user_name: true, employee: { select: { email: true } } } },
  workOrder: { select: { id: true, status: true, workOrderCode: true } },
} satisfies Prisma.BreakdownReportInclude;

function toDTO(row: any) {
  return {
    id: row.id,
    breakdownNumber: row.breakdownNumber ?? null,
    machineId: row.machineId,
    machineName: row.machine?.name ?? '',
    assetCode: row.machine?.assetCode ?? '',
    firmId: row.machine?.firmId ? String(row.machine.firmId) : undefined,
    firmName: row.machine?.firm?.firm_name,
    firm: row.machine?.firm ? { id: String(row.machine.firm.id), name: row.machine.firm.firm_name } : undefined,
    reportedAt: dateToISO(row.reportedAt),
    failureType: row.failureType,
    description: row.description,
    severity: row.severity,
    isResolved: row.status === 'RESOLVED' || row.status === 'CLOSED',
    resolvedAt: dateToISO(row.resolvedAt),
    rootCause: row.rootCause,
    correctiveAction: row.correctiveAction,
    estimatedDowntimeHours: decimalToNumberOrNull(row.estimatedDowntimeHours),
    actualDowntimeMinutes: row.actualDowntimeMinutes,
    remarks: row.remarks,
    reportedByName: userDTO(row.reportedBy)?.name ?? '',
    assigneeName: userDTO(row.assignedTo)?.name ?? null,
    workOrderId: row.workOrder?.id ?? null,
    workOrderCode: row.workOrder?.workOrderCode ?? (row.workOrder?.id ? `WO-${String(row.workOrder.id).slice(-6).toUpperCase()}` : null),
    workOrderStatus: row.workOrder?.status ?? null,
    status: row.status,
    tenant: null,
  };
}

export const breakdownService = {
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.BreakdownReportWhereInput = {
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.isResolved !== undefined
        ? query.isResolved === 'true' || query.isResolved === true
          ? { status: { in: ['RESOLVED', 'CLOSED'] } }
          : { status: { notIn: ['RESOLVED', 'CLOSED'] } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.breakdownReport.findMany({ where, include: INCLUDE, orderBy: { reportedAt: 'desc' }, skip, take: limit }),
      prisma.breakdownReport.count({ where }),
    ]);
    return { data: rows.map(toDTO), pagination: paginationMeta(page, limit, total) };
  },

  // Reporting a breakdown flips the Machine + linked Asset into a "down" state and
  // auto-creates a BREAKDOWN work order — see architecture doc §5 rule 5 (mirrors
  // `mockMaintenanceStore.createBreakdown()`).
  async create(body: { machineId: string; failureType: string; description: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; estimatedDowntimeHours?: number; remarks?: string; assignToUserId?: string }, reportedByUserId: bigint | null) {
    return prisma.$transaction(async (tx) => {
      const machine = await tx.machine.findUnique({ where: { id: body.machineId } });
      if (!machine) throw ApiError.badRequest('machineId does not reference an existing machine');

      const breakdownNumber = await documentSequenceService.next({ prefix: 'BD', year: new Date().getFullYear(), pad: 3 }, tx);
      const breakdown = await tx.breakdownReport.create({
        data: {
          breakdownNumber,
          machine: { connect: { id: body.machineId } },
          firm: machine.firmId ? { connect: { id: machine.firmId } } : undefined,
          failureType: body.failureType,
          description: body.description,
          severity: body.severity,
          status: 'OPEN',
          estimatedDowntimeHours: body.estimatedDowntimeHours ?? null,
          remarks: body.remarks ?? null,
          ...(reportedByUserId ? { reportedBy: { connect: { id: reportedByUserId } } } : {}),
          ...(body.assignToUserId ? { assignedTo: { connect: { id: BigInt(body.assignToUserId) } } } : {}),
        },
        include: INCLUDE,
      });

      await tx.machine.update({ where: { id: body.machineId }, data: { status: 'BREAKDOWN', statusChangedAt: new Date() } });
      if (machine.assetId) {
        await tx.asset.update({ where: { id: machine.assetId }, data: { status: 'UNDER_REPAIR' } });
      }

      await workOrderService.createInternal(tx, {
        machineId: body.machineId,
        breakdownReportId: breakdown.id,
        type: 'BREAKDOWN',
        actualDueDate: new Date(),
        priority: body.severity,
        currentAssigneeUserId: body.assignToUserId ? BigInt(body.assignToUserId) : undefined,
      });

      const full = await tx.breakdownReport.findUniqueOrThrow({ where: { id: breakdown.id }, include: INCLUDE });
      return toDTO(full);
    });
  },

  async resolve(id: string, body: { rootCause?: string; correctiveAction?: string; preventiveAction?: string }) {
    return prisma.$transaction(async (tx) => {
      const row = await tx.breakdownReport.findUnique({ where: { id }, include: { machine: true } });
      if (!row) throw ApiError.notFound('Breakdown report not found');

      const updated = await tx.breakdownReport.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          rootCause: body.rootCause ?? row.rootCause,
          correctiveAction: body.correctiveAction ?? row.correctiveAction,
          preventiveAction: body.preventiveAction ?? row.preventiveAction,
        },
        include: INCLUDE,
      });

      await tx.machine.update({ where: { id: row.machineId }, data: { status: 'OPERATIONAL', statusChangedAt: new Date() } });
      if (row.machine.assetId) {
        await tx.asset.update({ where: { id: row.machine.assetId }, data: { status: 'ACTIVE' } });
      }

      return toDTO(updated);
    });
  },

  async setStatus(id: string, status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED') {
    if (status === 'RESOLVED' || status === 'CLOSED') return this.resolve(id, {});
    const row = await prisma.breakdownReport.update({ where: { id }, data: { status }, include: INCLUDE });
    return toDTO(row);
  },
};
