import { prisma } from '../../../database/prisma';
import { Prisma } from '@prisma/client';

export const settingsRepository = {
  async upsertDefaults(client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.pettyCashSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        paymentModes: ['Cash', 'UPI', 'Bank Transfer', 'Cheque', 'Card'],
        lastSerialNumber: 0,
      },
      update: {},
    });
  },

  async update(data: Prisma.PettyCashSettingsUpdateInput, client: Prisma.TransactionClient | typeof prisma = prisma) {
    return client.pettyCashSettings.update({
      where: { id: 1 },
      data,
    });
  },

  async incrementSerial(client: Prisma.TransactionClient | typeof prisma = prisma) {
    await this.upsertDefaults(client);
    return client.pettyCashSettings.update({
      where: { id: 1 },
      data: { lastSerialNumber: { increment: 1 } },
    });
  },
};
