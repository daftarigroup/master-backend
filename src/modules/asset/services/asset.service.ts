import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { assetRepository } from '../repositories/asset.repository';
import { assetMapper } from './asset.mapper';

export const assetService = {
  async listAssets(query: Record<string, any> = {}) {
    const rows = await assetRepository.findMany({
      status: query.status,
      category: query.category,
      search: query.search,
      firmId: query.firmId || query.projectId,
    });
    return rows.map(assetMapper.toDTO);
  },

  async getAssetById(id: string) {
    const row = await assetRepository.findById(id);
    if (!row) throw ApiError.notFound('Asset not found');
    return assetMapper.toDTO(row);
  },

  async createAsset(body: Record<string, any>, createdById?: bigint | null) {
    return prisma.$transaction(async (tx) => {
      const assetCode = await documentSequenceService.next({ prefix: 'SN', year: 0, pad: 4 }, tx);
      const data = assetMapper.toPrismaCreate(body);
      let targetUserId = createdById;
      if (!targetUserId && body.createdById) {
        try { targetUserId = BigInt(body.createdById); } catch {}
      }
      if (!targetUserId && body.createdBy) {
        const found = await tx.user.findFirst({
          where: {
            OR: [
              { user_name: String(body.createdBy) },
              { name: String(body.createdBy) },
            ],
          },
          select: { id: true },
        });
        if (found) targetUserId = found.id;
      }
      if (!targetUserId) {
        const adminUser = await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
        if (adminUser) targetUserId = adminUser.id;
      }
      const userExists = targetUserId ? await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true } }) : null;
      const row = await assetRepository.create(
        { ...data, assetCode, ...(userExists ? { createdBy: { connect: { id: userExists.id } } } : {}) },
        tx
      );
      return assetMapper.toDTO(row);
    });
  },

  async updateAsset(id: string, body: Record<string, any>) {
    await this.assertExists(id);
    const data = assetMapper.toPrismaUpdate(body);
    const row = await assetRepository.update(id, data);
    return assetMapper.toDTO(row);
  },

  async deleteAsset(id: string) {
    await this.assertExists(id);
    await assetRepository.delete(id);
  },

  async assertExists(id: string) {
    const row = await assetRepository.findById(id);
    if (!row) throw ApiError.notFound('Asset not found');
    return row;
  },
};
