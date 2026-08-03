/**
 * Delay Calculation Service
 * Re-engineers database trigger delay calculations into pure TypeScript helpers.
 */

import { Prisma } from '@prisma/client';

export interface DelayCalculationResult {
  delayMs: number;
  delayFormatted: string | null;
  timeDelay: string | null;
}

export class DelayCalculatorService {
  /**
   * Calculates the difference between an actual timestamp and a planned timestamp.
   * Returns formatted duration (HH:MM:SS) if actual >= planned, else null.
   */
  public static calculateDelay(
    actual: Date | string | null | undefined,
    planned: Date | string | null | undefined,
    _tx?: Prisma.TransactionClient
  ): string | null {
    if (!actual || !planned) return null;

    const actualDate = new Date(actual);
    const plannedDate = new Date(planned);

    if (isNaN(actualDate.getTime()) || isNaN(plannedDate.getTime())) return null;

    const diffMs = actualDate.getTime() - plannedDate.getTime();
    if (diffMs < 0) return null;

    const totalSeconds = Math.floor(diffMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Calculates delays for Indent record stages 1 to 5, 7.
   */
  public static calculateIndentDelays(
    record: Record<string, any>,
    tx?: Prisma.TransactionClient
  ): Record<string, string | null> {
    return {
      time_delay1: this.calculateDelay(record.actual1, record.planned1, tx),
      time_delay2: this.calculateDelay(record.actual2, record.planned2, tx),
      time_delay3: this.calculateDelay(record.actual3, record.planned3, tx),
      time_delay4: this.calculateDelay(record.actual4, record.planned4, tx),
      time_delay: this.calculateDelay(record.actual5, record.planned5, tx),
      time_delay7: this.calculateDelay(record.actual7, record.planned7, tx),
    };
  }

  /**
   * Calculates delays for Store In stages 6, 7, 9, 11.
   */
  public static calculateStoreInDelays(
    record: Record<string, any>,
    tx?: Prisma.TransactionClient
  ): Record<string, string | null> {
    return {
      time_delay6: this.calculateDelay(record.actual6, record.planned6, tx),
      time_delay7: this.calculateDelay(record.actual7, record.planned7, tx),
      time_delay9: this.calculateDelay(record.actual9, record.planned9, tx),
      time_delay: this.calculateDelay(record.actual11, record.planned11, tx),
    };
  }

  /**
   * Calculates delays for Issue record.
   */
  public static calculateIssueDelays(
    record: Record<string, any>,
    tx?: Prisma.TransactionClient
  ): Record<string, string | null> {
    return {
      time_delay1: this.calculateDelay(record.actual1, record.planned1, tx),
    };
  }

  /**
   * Calculates delays for Fullkitting record.
   */
  public static calculateFullkittingDelays(
    record: Record<string, any>,
    tx?: Prisma.TransactionClient
  ): Record<string, string | null> {
    return {
      time_delay: this.calculateDelay(record.actual, record.planned, tx),
    };
  }

  /**
   * Calculates delays for Tally Entry stages 1 to 5.
   */
  public static calculateTallyEntryDelays(
    record: Record<string, any>,
    tx?: Prisma.TransactionClient
  ): Record<string, string | null> {
    return {
      delay1: this.calculateDelay(record.actual1, record.planned1, tx),
      delay2: this.calculateDelay(record.actual2, record.planned2, tx),
      delay3: this.calculateDelay(record.actual3, record.planned3, tx),
      delay4: this.calculateDelay(record.actual4, record.planned4, tx),
      delay5: this.calculateDelay(record.actual5, record.planned5, tx),
    };
  }
}
