import { ApiError } from '../../../utils/ApiError';
import { projectMasterRepository } from '../repositories/projectMaster.repository';

export const projectMasterService = {
  async listEntries(type?: string) {
    return projectMasterRepository.findMany(type);
  },

  async getEntryById(id: string) {
    const record = await projectMasterRepository.findById(id);
    if (!record) throw ApiError.notFound('Master entry not found');
    return record;
  },

  async createEntry({ type, value, address }: { type: string; value: string; address?: string }) {
    const existing = await projectMasterRepository.findByTypeValue(type, value);
    if (existing) throw ApiError.conflict(`"${value}" already exists`);
    return projectMasterRepository.create({ type, value, address });
  },

  async updateEntry(id: string, { value, address }: { value?: string; address?: string }) {
    await this.getEntryById(id);
    return projectMasterRepository.update(id, {
      ...(value !== undefined ? { value } : {}),
      ...(address !== undefined ? { address } : {}),
    });
  },

  async deleteEntry(id: string) {
    await this.getEntryById(id);
    await projectMasterRepository.remove(id);
  },
};
