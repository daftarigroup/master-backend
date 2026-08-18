import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { subscriptionsRepository } from '../repositories/subscriptions.repository';
import { docCounterService } from './docCounter.service';

function safeDate(val: any, fallback: Date | null = null): Date | null {
  if (!val) return fallback;
  const d = val instanceof Date ? val : new Date(val);
  return isNaN(d.getTime()) ? fallback : d;
}

export const subscriptionsService = {
  async listSubscriptions(filters: any = {}) {
    const page = filters.page ? Math.max(1, parseInt(String(filters.page), 10) || 1) : undefined;
    const limit = filters.limit ? Math.max(1, parseInt(String(filters.limit), 10) || 25) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const { items, total } = await subscriptionsRepository.findMany({
      ...filters,
      skip,
      take,
    });

    if (page && limit) {
      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }
    return items;
  },

  async getSubscriptionById(id: string) {
    const subscription = await subscriptionsRepository.findById(id);
    if (!subscription) throw ApiError.notFound('Subscription not found');
    return subscription;
  },

  async createSubscription({
    requestedDate,
    companyName,
    subscriberName,
    subscriptionName,
    price,
    frequency,
    purpose,
    startDate,
    endDate,
    plan,
    file,
    fileContent,
  }: {
    requestedDate: string | Date;
    companyName: string;
    subscriberName: string;
    subscriptionName: string;
    price: string;
    frequency: string;
    purpose: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    plan?: string;
    file?: string;
    fileContent?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const sn = await docCounterService.nextDocSerial('subscription', 'SN', tx);
      return subscriptionsRepository.create(
        {
          sn,
          requestedDate: new Date(requestedDate),
          companyName,
          subscriberName,
          subscriptionName,
          price,
          frequency,
          purpose,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          plan,
          file,
          fileContent,
        },
        tx
      );
    });
  },

  async updateSubscription(id: string, data: any) {
    await this.getSubscriptionById(id);
    const {
      companyName,
      subscriberName,
      subscriptionName,
      price,
      frequency,
      purpose,
      startDate,
      endDate,
      plan,
      file,
      fileContent,
      remarks,
    } = data;
    return subscriptionsRepository.update(id, {
      ...(companyName !== undefined ? { companyName } : {}),
      ...(subscriberName !== undefined ? { subscriberName } : {}),
      ...(subscriptionName !== undefined ? { subscriptionName } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(frequency !== undefined ? { frequency } : {}),
      ...(purpose !== undefined ? { purpose } : {}),
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      ...(plan !== undefined ? { plan } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(fileContent !== undefined ? { fileContent } : {}),
      ...(remarks !== undefined ? { remarks } : {}),
    });
  },

  async deleteSubscription(id: string) {
    await this.getSubscriptionById(id);
    await subscriptionsRepository.remove(id);
  },

  async recordApproval(
    id: string,
    { status, approvalNo, remarks }: { status: string; approvalNo?: string; remarks?: string }
  ) {
    if (!['Approved', 'Rejected'].includes(status)) {
      throw ApiError.badRequest('status must be Approved or Rejected');
    }
    await this.getSubscriptionById(id);
    return subscriptionsRepository.update(id, {
      status,
      approvalNo,
      approvalDate: new Date(),
      ...(remarks !== undefined ? { remarks } : {}),
    });
  },

  async recordPayment(
    id: string,
    {
      paymentMethod,
      paymentFile,
      paymentFileContent,
    }: {
      paymentMethod?: string;
      paymentFile?: string;
      paymentFileContent?: string;
    }
  ) {
    const subscription = await this.getSubscriptionById(id);
    if (subscription.status !== 'Approved') {
      throw ApiError.badRequest('Only approved subscriptions can be paid');
    }
    return subscriptionsRepository.update(id, {
      status: 'Paid',
      paymentDate: new Date(),
      ...(paymentMethod !== undefined ? { paymentMethod } : {}),
      ...(paymentFile !== undefined ? { paymentFile } : {}),
      ...(paymentFileContent !== undefined ? { paymentFileContent } : {}),
    });
  },

  async listRenewals(options: any = {}) {
    const subscriptionId = typeof options === 'string' ? options : options.subscriptionId;
    const page = options.page ? Math.max(1, parseInt(String(options.page), 10) || 1) : undefined;
    const limit = options.limit ? Math.max(1, parseInt(String(options.limit), 10) || 25) : undefined;
    const skip = page && limit ? (page - 1) * limit : undefined;
    const take = limit;

    const { items, total } = await subscriptionsRepository.findRenewals({
      subscriptionId,
      search: typeof options === 'object' ? options.search : undefined,
      skip,
      take,
    });

    if (page && limit) {
      return {
        items,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
      };
    }
    return items;
  },

  async recordRenewal(subscriptionId: string, { endDate }: { endDate?: string | Date | null }) {
    const subscription = await this.getSubscriptionById(subscriptionId);

    return prisma.$transaction(async (tx) => {
      const renewalNo = await docCounterService.nextDocSerial('subscriptionRenewal', 'RN', tx);
      const renewal = await subscriptionsRepository.createRenewal(
        {
          subscriptionId,
          renewalNo,
          sn: subscription.sn,
          companyName: subscription.companyName,
          subscriberName: subscription.subscriberName,
          subscriptionName: subscription.subscriptionName,
          frequency: subscription.frequency,
          price: subscription.price,
          endDate: endDate ? new Date(endDate) : null,
          renewalStatus: 'Yes',
        },
        tx
      );

      await subscriptionsRepository.update(
        subscriptionId,
        { endDate: endDate ? new Date(endDate) : subscription.endDate },
        tx
      );

      return renewal;
    });
  },
};
