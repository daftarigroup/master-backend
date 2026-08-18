import { settingsRepository } from '../repositories/settings.repository';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export const settingsService = {
  async getSettings() {
    return settingsRepository.upsertDefaults();
  },

  async updateSettings(data: { paymentModes?: string[] }) {
    await this.getSettings();
    return settingsRepository.update({
      ...(data.paymentModes !== undefined ? { paymentModes: data.paymentModes } : {}),
    });
  },

  async addPaymentMode(name: string) {
    const settings = await this.getSettings();
    if (settings.paymentModes.includes(name)) return settings;
    return settingsRepository.update({ paymentModes: { push: name } });
  },

  async removePaymentMode(name: string) {
    const settings = await this.getSettings();
    return settingsRepository.update({
      paymentModes: settings.paymentModes.filter((m: string) => m !== name),
    });
  },

  async nextSerialNumber(prefix: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
    const settings = await settingsRepository.incrementSerial(client);
    return `${prefix}-${settings.lastSerialNumber}`;
  },
};
