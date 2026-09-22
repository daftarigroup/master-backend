import { Prisma } from '@prisma/client';
import { ApiError } from '../../../utils/ApiError';
import { machinePartRepository } from '../repositories/machinePart.repository';
import { machinePartMapper } from './machine.mapper';
import { parsePagination, paginationMeta } from './mapUtils';

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
    return machinePartMapper.toDTO(row);
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
