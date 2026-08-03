/**
 * Sequence & ID Generation Service
 * Re-engineers database sequence functions and payment link generators.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export class SequenceService {
  private prisma: any;

  constructor(prismaClient?: any) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * Generates Indent Number in format SI-0001 using DB sequence or atomic count.
   */
  public async generateIndentNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma || prisma;
    try {
      const result: any[] = await db.$queryRaw`
        SELECT COALESCE(MAX(CAST(SUBSTRING(indent_number, 4) AS INTEGER)), 0) + 1 as next_val
        FROM indent
        WHERE indent_number LIKE 'SI-%'
      `;
      const nextVal = result?.[0]?.next_val || 1;
      return `SI-${String(nextVal).padStart(4, '0')}`;
    } catch {
      const result: any[] = await db.$queryRaw`SELECT nextval('indent_number_seq')::text as next_val`;
      const nextVal = result?.[0]?.next_val || '1';
      return `SI-${nextVal.padStart(4, '0')}`;
    }
  }

  /**
   * Generates Issue Number in format IS-001 by finding MAX(SUBSTRING(issue_no, 4)).
   */
  public async generateIssueNo(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma || prisma;
    const result: any[] = await db.$queryRaw`
      SELECT COALESCE(MAX(CAST(SUBSTRING(issue_no, 4) AS INTEGER)), 0) + 1 as next_val FROM issue
    `;
    const nextVal = result?.[0]?.next_val || 1;
    return `IS-${String(nextVal).padStart(3, '0')}`;
  }

  /**
   * Generates Lift Number in format LN-1001.
   */
  public async generateLiftNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma || prisma;
    const result: any[] = await db.$queryRaw`SELECT nextval('lift_number_seq')::text as next_val`;
    const nextVal = result?.[0]?.next_val || '1';
    return `LN-${nextVal}`;
  }

  /**
   * Generates PO Number in format STORE-PO-25-26-1001.
   */
  public async generatePoNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const db = tx || this.prisma || prisma;
    const result: any[] = await db.$queryRaw`SELECT nextval('po_master_seq')::text as next_val`;
    const nextVal = result?.[0]?.next_val || '1';
    return `STORE-PO-25-26-${nextVal}`;
  }

  /**
   * Generates Make Payment Form link.
   */
  public static generateMakePaymentLink(indentNumber?: string, _tx?: Prisma.TransactionClient): string {
    if (!indentNumber) return '';
    const base = '';
    return `${base}&entry.1200639812=${encodeURIComponent(indentNumber)}&entry.604194301=Store+FMS&entry.1358288895=Yes`;
  }
}
