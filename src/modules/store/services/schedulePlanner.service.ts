/**
 * Schedule & Planned Date Service
 * Re-engineers database trigger planned date logic & Sunday skipping.
 */

import { Prisma } from '@prisma/client';

export class SchedulePlannerService {
  /**
   * Checks if a date falls on Sunday (0 = Sunday in JS Date / Postgres DOW).
   */
  public static isSunday(date: Date, _tx?: Prisma.TransactionClient): boolean {
    return date.getDay() === 0;
  }

  /**
   * Adjusts a date to Monday if it falls on a Sunday, preserving time.
   */
  public static skipSunday(date: Date, tx?: Prisma.TransactionClient): Date {
    const result = new Date(date.getTime());
    if (this.isSunday(result, tx)) {
      result.setDate(result.getDate() + 1);
    }
    return result;
  }

  /**
   * Adds N workdays to a base timestamp, skipping Sundays.
   */
  public static addWorkdaysSkippingSundays(baseDate: Date, workdays: number, tx?: Prisma.TransactionClient): Date {
    let current = new Date(baseDate.getTime());
    let added = 0;

    while (added < workdays) {
      current.setDate(current.getDate() + 1);
      if (!this.isSunday(current, tx)) {
        added++;
      }
    }
    return current;
  }

  /**
   * Generates planned6 from timestamp skipping Sunday.
   */
  public static generatePlanned6(timestamp: Date | string | null, tx?: Prisma.TransactionClient): Date | null {
    if (!timestamp) return null;
    return this.skipSunday(new Date(timestamp), tx);
  }

  /**
   * Generates planned7 from actual5 (unless payment_term is 'After Delivery').
   */
  public static generatePlanned7(
    actual5: Date | string | null,
    paymentTerm?: string,
    tx?: Prisma.TransactionClient
  ): Date | null {
    if (!actual5 || paymentTerm === 'After Delivery') return null;
    return this.addWorkdaysSkippingSundays(new Date(actual5), 1, tx);
  }

  /**
   * Sets planned4 based on vendor_type:
   * If vendor_type === 'Regular' => actual2, else actual3.
   */
  public static generatePlanned4(
    vendorType: string,
    actual2?: Date | string | null,
    actual3?: Date | string | null,
    _tx?: Prisma.TransactionClient
  ): Date | null {
    const dateSource = vendorType === 'Regular' ? actual2 : actual3;
    return dateSource ? new Date(dateSource) : null;
  }

  /**
   * Generates planned9 based on send_debit_note === 'Yes' and actual7.
   */
  public static generatePlanned9(
    sendDebitNote: string | undefined,
    actual7: Date | string | null,
    tx?: Prisma.TransactionClient
  ): Date | null {
    if (sendDebitNote !== 'Yes' || !actual7) return null;
    return this.skipSunday(new Date(actual7), tx);
  }

  /**
   * Generates planned11 for store_in:
   * If bill_status === 'Not Received', adds 3 workdays skipping Sundays.
   */
  public static generatePlanned11(
    billStatus: string,
    timestamp: Date | string | null,
    tx?: Prisma.TransactionClient
  ): Date | null {
    if (billStatus !== 'Not Received' || !timestamp) return null;
    return this.addWorkdaysSkippingSundays(new Date(timestamp), 3, tx);
  }

  /**
   * Calculates tally_entry workflow planned dates based on status1..4 transitions.
   */
  public static calculateTallyWorkflowPlannedDates(
    currentRecord: Record<string, any>,
    updates: Record<string, any>,
    _tx?: Prisma.TransactionClient
  ): Record<string, Date | null> {
    const merged = { ...currentRecord, ...updates };
    const result: Record<string, Date | null> = {};

    // actual1 transition
    if (merged.actual1 && !currentRecord.actual1) {
      if (merged.status1 === 'Done' && !merged.planned4) {
        result.planned4 = new Date();
      } else if (merged.status1 === 'Not Done' && !merged.planned2) {
        result.planned2 = new Date();
      }
    }

    // actual2 transition
    if (merged.actual2 && !currentRecord.actual2) {
      if (merged.status2 === 'Done' && !merged.planned3) {
        result.planned3 = new Date();
      }
    }

    // actual3 transition
    if (merged.actual3 && !currentRecord.actual3) {
      if (merged.status3 === 'Done' && !merged.planned4) {
        result.planned4 = new Date();
      }
    }

    // actual4 transition
    if (merged.actual4 && !currentRecord.actual4) {
      if (merged.status4 === 'Done' && !merged.actual5) {
        result.actual5 = new Date();
      } else if (merged.status4 === 'Not Done' && !merged.planned2) {
        result.planned2 = new Date();
      }
    }

    return result;
  }
}
