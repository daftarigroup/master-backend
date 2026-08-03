/**
 * PC Report KPI Metric Service
 * Re-engineers database trigger pc_report aggregation functions across all stages.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';

export class PcReportService {
  private prisma: any;

  constructor(prismaClient?: any) {
    this.prisma = prismaClient || prisma;
  }

  /**
   * Recalculates PC Report KPIs for a given workflow stage.
   */
  public async recalculateStageKpis(stageName: string, tx?: Prisma.TransactionClient): Promise<void> {
    switch (stageName) {
      case 'Should Need Offer Or Regular':
        await this.recalculateIndentStage('planned1', 'actual1', 'Should Need Offer Or Regular', tx);
        break;

      case 'Reguler Or Need Offer Rate Update':
        await this.recalculateIndentStage('planned2', 'actual2', 'Reguler Or Need Offer Rate Update', tx);
        break;

      case 'Approval And Rejection For Purchase':
        await this.recalculateIndentStage('planned3', 'actual3', 'Approval And Rejection For Purchase', tx);
        break;

      case 'PO WebApp':
        await this.recalculateIndentStage('planned4', 'actual4', 'PO WebApp', tx);
        break;

      case 'Material Lifting':
        await this.recalculateIndentStage('planned5', 'actual5', 'Material Lifting', tx);
        break;

      case 'Store Out Approval':
        await this.recalculateIndentStage('planned7', 'actual7', 'Store Out Approval', tx);
        break;

      case 'Received In Store':
        await this.recalculateStoreInStage('planned6', 'actual6', 'Received In Store', tx);
        break;

      case 'Quality Check In Received Item':
        await this.recalculateStoreInStage('planned7', 'actual7', 'Quality Check In Received Item', tx);
        break;

      case 'Send Debit Note':
        await this.recalculateStoreInStage('planned9', 'actual9', 'Send Debit Note', tx);
        break;

      case 'Audit Data':
        await this.recalculateTallyStage('planned1', 'actual1', 'Audit Data', tx);
        break;

      case 'Rectify the mistake':
        await this.recalculateTallyStage('planned2', 'actual2', 'Rectify the mistake', tx);
        break;

      case 'Reaudit Data':
        await this.recalculateTallyStage('planned3', 'actual3', 'Reaudit Data', tx);
        break;

      case 'Take Entry By Tally':
        await this.recalculateTallyStage('planned4', 'actual4', 'Take Entry By Tally', tx);
        break;

      case 'Again Audit':
        await this.recalculateTallyStage('planned5', 'actual5', 'Again Audit', tx);
        break;

      case 'Issue Data':
        await this.recalculateIssueStage(tx);
        break;

      default:
        break;
    }
  }

  private async recalculateIndentStage(
    plannedCol: string,
    actualCol: string,
    stageName: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const db = tx || this.prisma || prisma;
    const raw: any[] = await db.$queryRawUnsafe(`
      SELECT 
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL THEN 1 END) as pending,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NOT NULL THEN 1 END) as complete,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name = 'PMPL' THEN 1 END) as pmpl,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name = 'PURAB' THEN 1 END) as purab,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name = 'PMMPL' THEN 1 END) as pmmpl,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name = 'REFRASYNTH' THEN 1 END) as refrasynth
      FROM indent
    `);
    await this.updatePcReportRecord(stageName, raw[0], tx);
  }

  private async recalculateStoreInStage(
    plannedCol: string,
    actualCol: string,
    stageName: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const db = tx || this.prisma || prisma;
    const raw: any[] = await db.$queryRawUnsafe(`
      SELECT 
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL THEN 1 END) as pending,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NOT NULL THEN 1 END) as complete,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'PMPL' THEN 1 END) as pmpl,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'PURAB' THEN 1 END) as purab,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'PMMPL' THEN 1 END) as pmmpl,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'REFRASYNTH' THEN 1 END) as refrasynth
      FROM store_in
    `);
    await this.updatePcReportRecord(stageName, raw[0], tx);
  }

  private async recalculateTallyStage(
    plannedCol: string,
    actualCol: string,
    stageName: string,
    tx?: Prisma.TransactionClient
  ): Promise<void> {
    const db = tx || this.prisma || prisma;
    const raw: any[] = await db.$queryRawUnsafe(`
      SELECT 
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL THEN 1 END) as pending,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NOT NULL THEN 1 END) as complete,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'PMPL' THEN 1 END) as pmpl,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'PURAB' THEN 1 END) as purab,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'PMMPL' THEN 1 END) as pmmpl,
        COUNT(CASE WHEN ${plannedCol} IS NOT NULL AND ${actualCol} IS NULL AND firm_name_match = 'REFRASYNTH' THEN 1 END) as refrasynth
      FROM tally_entry
    `);
    await this.updatePcReportRecord(stageName, raw[0], tx);
  }

  private async recalculateIssueStage(tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx || this.prisma || prisma;
    const raw: any[] = await db.$queryRaw`
      SELECT 
        COUNT(CASE WHEN planned1 IS NOT NULL AND actual1 IS NULL THEN 1 END) as pending,
        COUNT(CASE WHEN planned1 IS NOT NULL AND actual1 IS NOT NULL THEN 1 END) as complete
      FROM issue
    `;
    const data = {
      pending: raw[0]?.pending || 0,
      complete: raw[0]?.complete || 0,
      pmpl: 0,
      purab: 0,
      pmmpl: 0,
      refrasynth: 0,
    };
    await this.updatePcReportRecord('Issue Data', data, tx);
  }

  private async updatePcReportRecord(stageName: string, metrics: any, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx || this.prisma || prisma;
    await db.$executeRaw`
      UPDATE pc_report
      SET 
        total_pending = ${Number(metrics.pending || 0)},
        total_complete = ${Number(metrics.complete || 0)},
        pending_pmpl = ${Number(metrics.pmpl || 0)},
        pending_purab = ${Number(metrics.purab || 0)},
        pending_pmmpl = ${Number(metrics.pmmpl || 0)},
        pending_refrasynth = ${Number(metrics.refrasynth || 0)},
        updated_at = NOW()
      WHERE stage = ${stageName}
    `;
  }
}
