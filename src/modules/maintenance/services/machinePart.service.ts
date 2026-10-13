import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { machinePartRepository } from '../repositories/machinePart.repository';
import { machinePartMapper } from './machine.mapper';
import { parsePagination, paginationMeta, dateToISO } from './mapUtils';

export const machinePartService = {
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.MachinePartWhereInput = {
      ...(query.machineId ? { machineId: query.machineId } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      machinePartRepository.findMany(where, skip, limit),
      machinePartRepository.count(where),
    ]);
    return { data: rows.map(machinePartMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async getById(id: string) {
    const row = await machinePartRepository.findById(id);
    if (!row) throw ApiError.notFound('Machine part not found');

    const workOrders = await prisma.maintenanceWorkOrder.findMany({
      where: {
        machineId: row.machineId,
        OR: [
          { machinePartId: row.id },
          { repairParts: { some: { OR: [{ machinePartId: row.id }, { partName: { equals: row.name, mode: 'insensitive' } }] } } },
          { replacementParts: { some: { name: { equals: row.name, mode: 'insensitive' } } } },
        ],
      },
      include: {
        completedBy: { select: { id: true, name: true } },
        currentAssignee: { select: { id: true, name: true } },
        responsible: { select: { id: true, name: true } },
        repairParts: true,
        breakdownReport: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const mappedWorkOrders = workOrders.map((wo) => ({
      id: wo.id,
      workOrderCode: wo.workOrderCode ?? undefined,
      type: wo.type,
      status: wo.status,
      priority: wo.priority,
      completedAt: dateToISO(wo.completedAt ?? wo.scheduledDate ?? wo.createdAt),
      scheduledDate: dateToISO(wo.scheduledDate),
      completedBy: wo.completedBy
        ? { id: String(wo.completedBy.id), name: wo.completedBy.name }
        : wo.currentAssignee
          ? { id: String(wo.currentAssignee.id), name: wo.currentAssignee.name }
          : wo.responsible
            ? { id: String(wo.responsible.id), name: wo.responsible.name }
            : undefined,
      completionNote: wo.completionNote || wo.description || 'Component serviced',
      createdAt: dateToISO(wo.createdAt),
    }));

    const breakdownMap = new Map<string, any>();
    for (const wo of workOrders) {
      if (wo.breakdownReport) {
        const br = wo.breakdownReport;
        breakdownMap.set(br.id, {
          id: br.id,
          breakdownNumber: br.breakdownNumber,
          title: br.failureType ? `${br.failureType}: ${br.description}` : (br.description || br.breakdownNumber || 'Breakdown Incident'),
          description: br.description,
          severity: br.severity,
          status: br.status,
          isResolved: br.status === 'RESOLVED' || br.status === 'CLOSED' || br.resolvedAt !== null,
          reportedAt: dateToISO(br.reportedAt),
          resolvedAt: br.resolvedAt ? dateToISO(br.resolvedAt) : null,
        });
      }
    }

    const directBreakdowns = await prisma.breakdownReport.findMany({
      where: {
        machineId: row.machineId,
        OR: [
          { description: { contains: row.name, mode: 'insensitive' } },
          { failureType: { contains: row.name, mode: 'insensitive' } },
        ],
      },
      orderBy: { reportedAt: 'desc' },
    });

    for (const br of directBreakdowns) {
      if (!breakdownMap.has(br.id)) {
        breakdownMap.set(br.id, {
          id: br.id,
          breakdownNumber: br.breakdownNumber,
          title: br.failureType ? `${br.failureType}: ${br.description}` : (br.description || br.breakdownNumber || 'Breakdown Incident'),
          description: br.description,
          severity: br.severity,
          status: br.status,
          isResolved: br.status === 'RESOLVED' || br.status === 'CLOSED' || br.resolvedAt !== null,
          reportedAt: dateToISO(br.reportedAt),
          resolvedAt: br.resolvedAt ? dateToISO(br.resolvedAt) : null,
        });
      }
    }

    const breakdowns = Array.from(breakdownMap.values());

    return {
      ...machinePartMapper.toDTO(row),
      workOrders: mappedWorkOrders,
      breakdowns,
    };
  },

  async create(body: { machineId: string; name: string; partNumber?: string; description?: string; imageUrl?: string }) {
    const row = await machinePartRepository.create({
      machine: { connect: { id: body.machineId } },
      name: body.name,
      partNumber: body.partNumber ?? null,
      description: body.description ?? null,
      imageUrl: body.imageUrl ?? null,
    });
    return machinePartMapper.toDTO(row);
  },

  async update(id: string, body: Record<string, any>) {
    await this.assertExists(id);
    const data: Record<string, any> = {};
    for (const key of ['name', 'partNumber', 'description', 'imageUrl', 'isActive'] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    const row = await machinePartRepository.update(id, data);
    return machinePartMapper.toDTO(row);
  },

  async delete(id: string) {
    await this.assertExists(id);
    await machinePartRepository.delete(id);
  },

  async assertExists(id: string) {
    const row = await machinePartRepository.findById(id);
    if (!row) throw ApiError.notFound('Machine part not found');
    return row;
  },
};
