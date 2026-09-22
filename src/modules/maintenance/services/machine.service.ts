import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { machineRepository } from '../repositories/machine.repository';
import { machineMapper } from './machine.mapper';
import { parsePagination, paginationMeta } from './mapUtils';

export const machineService = {
  async list(query: Record<string, any>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.MachineWhereInput = {
      ...(query.firmId ? { firmId: BigInt(query.firmId) } : {}),
      ...(query.projectId ? { firmId: BigInt(query.projectId) } : {}),
      ...(query.departmentId ? { departmentId: BigInt(query.departmentId) } : {}),
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.needMaintenance === 'true' ? { status: { in: ['UNDER_MAINTENANCE', 'BREAKDOWN'] } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { assetCode: { contains: query.search, mode: 'insensitive' } },
              { serialNumber: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([machineRepository.findMany(where, skip, limit), machineRepository.count(where)]);

    return { data: rows.map(machineMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async getById(id: string) {
    const row = await machineRepository.findById(id);
    if (!row) throw ApiError.notFound('Machine not found');
    return machineMapper.toDTO(row);
  },

  // Creating a machine also registers a matching Asset (category MACHINERY),
  // mirroring the frontend mock's `mockMaintenanceStore.createMachine()` behavior —
  // see ASSET_MAINTENANCE_REPAIR_SCHEMA_ARCHITECTURE.md. `Machine.assetId` is the
  // real FK the fuzzy string-matching in that mock was standing in for.
  async create(body: Record<string, any>) {
    return prisma.$transaction(async (tx) => {
      let assetCode = body.assetCode?.trim();
      if (assetCode) {
        const clash = await tx.machine.findUnique({ where: { assetCode } });
        if (clash) throw ApiError.conflict(`assetCode "${assetCode}" is already in use`);
      } else {
        assetCode = await documentSequenceService.next({ prefix: 'SN', year: 0, pad: 4 }, tx);
      }

      const firmId = body.firmId ? BigInt(body.firmId) : (body.projectId ? BigInt(body.projectId) : null);

      const asset = await tx.asset.create({
        data: {
          assetCode,
          firmId,
          productName: body.name,
          category: 'MACHINERY',
          type: 'ASSET',
          brand: body.manufacturer ?? null,
          model: body.modelNumber ?? null,
          serialNo: body.serialNumber ?? null,
          location: body.location ?? null,
          status: 'ACTIVE',
          maintenanceRequired: true,
        },
      });

      const machineData = machineMapper.toPrismaCreate(body);
      const machine = await tx.machine.create({
        data: { ...machineData, assetCode, assetId: asset.id },
        include: { department: true, firm: { select: { id: true, firm_name: true } }, _count: { select: { workOrders: true, breakdownReports: true, parts: true, maintenancePlans: true } } },
      });

      if (Array.isArray(body.parts) && body.parts.length > 0) {
        await tx.machinePart.createMany({
          data: body.parts.map((p: any) => ({
            machineId: machine.id,
            name: p.name,
            partNumber: p.partNumber ?? null,
            description: p.description ?? null,
            imageUrl: p.imageUrl ?? null,
          })),
        });
      }

      return machineMapper.toDTO(machine);
    });
  },

  async update(id: string, body: Record<string, any>) {
    await this.assertExists(id);
    const data = machineMapper.toPrismaUpdate(body);
    const row = await machineRepository.update(id, data);
    return machineMapper.toDTO(row);
  },

  async delete(id: string) {
    await this.assertExists(id);
    await machineRepository.delete(id);
  },

  async assertExists(id: string) {
    const row = await machineRepository.findById(id);
    if (!row) throw ApiError.notFound('Machine not found');
    return row;
  },
};
