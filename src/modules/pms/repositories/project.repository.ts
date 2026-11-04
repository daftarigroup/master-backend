import { prisma } from '../../../database/prisma';

export class PMSRepository {
  // Helper to find project by ID or serial_no
  async findProjectByIdOrSerial(identifier: string | number | bigint) {
    const str = String(identifier).trim();
    const isNumeric = /^\d+$/.test(str);
    if (isNumeric) {
      const project = await prisma.pMSProject.findFirst({
        where: {
          OR: [
            { id: BigInt(str) },
            { serial_no: str },
          ],
        },
      });
      if (project) return project;
    }
    return prisma.pMSProject.findUnique({
      where: { serial_no: str },
    });
  }

  // --- Project CRUD ---
  async listProjects(filters?: {
    search?: string;
    status?: string;
    contractorNames?: string[];
  }) {
    const where: any = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.contractorNames && filters.contractorNames.length > 0) {
      where.contractor_name = { in: filters.contractorNames };
    }

    if (filters?.search) {
      const s = filters.search;
      where.OR = [
        { project_name: { contains: s, mode: 'insensitive' } },
        { serial_no: { contains: s, mode: 'insensitive' } },
        { contractor_name: { contains: s, mode: 'insensitive' } },
        { department: { contains: s, mode: 'insensitive' } },
        { division: { contains: s, mode: 'insensitive' } },
        { village: { contains: s, mode: 'insensitive' } },
        { district: { contains: s, mode: 'insensitive' } },
      ];
    }

    return prisma.pMSProject.findMany({
      where,
      orderBy: { id: 'desc' },
      include: {
        minors: true,
      },
    });
  }

  async getProject(identifier: string | number | bigint) {
    const project = await this.findProjectByIdOrSerial(identifier);
    if (!project) return null;

    return prisma.pMSProject.findUnique({
      where: { id: project.id },
      include: {
        minors: {
          include: {
            schedule: true,
          },
        },
        designs: true,
        finalize_consultant: true,
        drawing_upload: true,
        final_approval: true,
        drawing: true,
      },
    });
  }

  async createProject(data: any) {
    return prisma.pMSProject.create({
      data,
    });
  }

  async updateProject(identifier: string | number | bigint, data: any) {
    const project = await this.findProjectByIdOrSerial(identifier);
    if (!project) return null;

    return prisma.pMSProject.update({
      where: { id: project.id },
      data,
    });
  }

  async deleteProject(identifier: string | number | bigint) {
    const project = await this.findProjectByIdOrSerial(identifier);
    if (!project) return null;

    return prisma.pMSProject.delete({
      where: { id: project.id },
    });
  }

  // --- Minors CRUD ---
  async listMinors(projectIdOrSerial: string | number | bigint) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return [];

    return prisma.pMSProjectMinor.findMany({
      where: { project_id: project.id },
      include: { schedule: true },
      orderBy: { created_at: 'asc' },
    });
  }

  async getMinor(minorId: string) {
    return prisma.pMSProjectMinor.findUnique({
      where: { id: minorId },
      include: { schedule: true },
    });
  }

  async createMinor(data: any) {
    return prisma.pMSProjectMinor.create({
      data,
    });
  }

  async updateMinor(minorId: string, data: any) {
    return prisma.pMSProjectMinor.update({
      where: { id: minorId },
      data,
    });
  }

  async deleteMinor(minorId: string) {
    return prisma.pMSProjectMinor.delete({
      where: { id: minorId },
    });
  }

  // --- Design ---
  async getDesign(projectIdOrSerial: string | number | bigint) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return null;

    return prisma.pMSProjectDesign.findFirst({
      where: { project_id: project.id },
    });
  }

  async upsertDesign(project: any, rows: any) {
    return prisma.pMSProjectDesign.upsert({
      where: { project_no: project.serial_no },
      create: {
        project_id: project.id,
        project_no: project.serial_no,
        rows,
      },
      update: {
        rows,
      },
    });
  }

  // --- DPR Execution ---
  async listExecutions(projectIdOrSerial: string | number | bigint, stageNumber?: number) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return [];

    const where: any = { project_id: project.id };
    if (stageNumber !== undefined) where.stage_number = stageNumber;

    return prisma.pMSProjectExecution.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async createExecution(data: any) {
    return prisma.pMSProjectExecution.create({
      data,
    });
  }

  async updateExecution(entryId: string | number | bigint, data: any) {
    const id = BigInt(String(entryId));
    return prisma.pMSProjectExecution.update({
      where: { id },
      data,
    });
  }

  async deleteExecution(entryId: string | number | bigint) {
    const id = BigInt(String(entryId));
    return prisma.pMSProjectExecution.delete({
      where: { id },
    });
  }

  // --- Actual Measurements ---
  async listActuals(projectIdOrSerial: string | number | bigint, stageNumber?: number) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return [];

    const where: any = { project_id: project.id };
    if (stageNumber !== undefined) where.stage_number = stageNumber;

    return prisma.pMSProjectActual.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async createActual(data: any) {
    return prisma.pMSProjectActual.create({
      data,
    });
  }

  async updateActual(entryId: string | number | bigint, data: any) {
    const id = BigInt(String(entryId));
    return prisma.pMSProjectActual.update({
      where: { id },
      data,
    });
  }

  async deleteActual(entryId: string | number | bigint) {
    const id = BigInt(String(entryId));
    return prisma.pMSProjectActual.delete({
      where: { id },
    });
  }

  // --- Stage Entries ---
  async listStageEntries(projectIdOrSerial: string | number | bigint, stageNumber?: number) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return [];

    const where: any = { project_id: project.id };
    if (stageNumber !== undefined) where.stage_number = stageNumber;

    return prisma.pMSStageEntry.findMany({
      where,
      orderBy: [{ stage_number: 'asc' }, { step_index: 'asc' }],
    });
  }

  async upsertStageEntry(stageEntryId: string, data: any) {
    return prisma.pMSStageEntry.upsert({
      where: { id: stageEntryId },
      create: {
        id: stageEntryId,
        ...data,
      },
      update: data,
    });
  }

  // --- Contractor & Pipeline Stages ---
  async getFinalizeConsultant(projectNo: string) {
    return prisma.pMSFinalizeConsultant.findUnique({
      where: { project_no: projectNo },
    });
  }

  async upsertFinalizeConsultant(projectNo: string, consultants: any) {
    return prisma.pMSFinalizeConsultant.upsert({
      where: { project_no: projectNo },
      create: { project_no: projectNo, consultants },
      update: { consultants },
    });
  }

  async getDrawingUpload(projectNo: string) {
    return prisma.pMSDrawingUpload.findUnique({
      where: { project_no: projectNo },
    });
  }

  async upsertDrawingUpload(projectNo: string, data: any) {
    return prisma.pMSDrawingUpload.upsert({
      where: { project_no: projectNo },
      create: { project_no: projectNo, ...data },
      update: data,
    });
  }

  async getFinalApproval(projectNo: string) {
    return prisma.pMSFinalApproval.findUnique({
      where: { project_no: projectNo },
    });
  }

  async upsertFinalApproval(projectNo: string, data: any) {
    return prisma.pMSFinalApproval.upsert({
      where: { project_no: projectNo },
      create: { project_no: projectNo, ...data },
      update: data,
    });
  }

  async getDrawings(projectNo: string) {
    return prisma.pMSDrawing.findUnique({
      where: { project_no: projectNo },
    });
  }

  async upsertDrawings(projectNo: string, minors: any) {
    return prisma.pMSDrawing.upsert({
      where: { project_no: projectNo },
      create: { project_no: projectNo, minors },
      update: { minors },
    });
  }

  // --- Material Requirements ---
  async listMaterialRequirements(projectIdOrSerial: string | number | bigint) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return [];

    return prisma.pMSMaterialRequirement.findMany({
      where: { project_id: project.id },
      orderBy: { created_at: 'desc' },
    });
  }

  async createMaterialRequirement(data: any) {
    return prisma.pMSMaterialRequirement.create({
      data,
    });
  }

  async deleteMaterialRequirement(reqId: string | number | bigint) {
    const id = BigInt(String(reqId));
    return prisma.pMSMaterialRequirement.delete({
      where: { id },
    });
  }

  // --- Schedules ---
  async getSchedule(minorId: string) {
    return prisma.pMSSchedule.findUnique({
      where: { minor_id: minorId },
    });
  }

  async upsertSchedule(minorId: string, data: any) {
    return prisma.pMSSchedule.upsert({
      where: { minor_id: minorId },
      create: { minor_id: minorId, ...data },
      update: data,
    });
  }

  // --- RM Bills ---
  async listRMBills(projectIdOrSerial: string | number | bigint, billType?: string) {
    const project = await this.findProjectByIdOrSerial(projectIdOrSerial);
    if (!project) return [];

    const where: any = { project_id: project.id };
    if (billType) where.bill_type = billType;

    return prisma.pMSRMBill.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async createRMBill(data: any) {
    return prisma.pMSRMBill.create({
      data,
    });
  }

  async getRMBill(billId: string | number | bigint) {
    const id = BigInt(String(billId));
    return prisma.pMSRMBill.findUnique({
      where: { id },
      include: { project: true },
    });
  }

  async updateRMBill(billId: string | number | bigint, data: any) {
    const id = BigInt(String(billId));
    return prisma.pMSRMBill.update({
      where: { id },
      data,
    });
  }

  async deleteRMBill(billId: string | number | bigint) {
    const id = BigInt(String(billId));
    return prisma.pMSRMBill.delete({
      where: { id },
    });
  }

  // --- Calculation State (Abstract, RA Planning, Final Comparative) ---
  async getCalcState(projectNo: string, stateType: string) {
    return prisma.pMSCalculationState.findUnique({
      where: {
        project_no_state_type: {
          project_no: projectNo,
          state_type: stateType,
        },
      },
    });
  }

  async upsertCalcState(projectNo: string, stateType: string, stateData: any, auditLogs?: any, snapshots?: any) {
    return prisma.pMSCalculationState.upsert({
      where: {
        project_no_state_type: {
          project_no: projectNo,
          state_type: stateType,
        },
      },
      create: {
        project_no: projectNo,
        state_type: stateType,
        version: stateData?.version || 1,
        data: stateData,
        audit_logs: auditLogs || stateData?.auditLogs || null,
        snapshots: snapshots || null,
      },
      update: {
        version: stateData?.version || 1,
        data: stateData,
        audit_logs: auditLogs || stateData?.auditLogs || undefined,
        snapshots: snapshots || undefined,
      },
    });
  }

  // --- Documents ---
  async listDocuments(projectNo?: string) {
    const where: any = {};
    if (projectNo) where.project_no = projectNo;

    return prisma.pMSDocument.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
  }

  async createDocument(data: any) {
    return prisma.pMSDocument.create({
      data,
    });
  }

  async deleteDocument(docId: string | number | bigint) {
    const str = String(docId);
    const isNumeric = /^\d+$/.test(str);
    if (isNumeric) {
      return prisma.pMSDocument.delete({
        where: { id: BigInt(str) },
      });
    }
    return prisma.pMSDocument.delete({
      where: { document_uid: str },
    });
  }

  // --- Email Logs ---
  async listEmailLogs(projectNo?: string) {
    const where: any = {};
    if (projectNo) where.project_no = projectNo;

    return prisma.pMSEmailLog.findMany({
      where,
      orderBy: { sent_at: 'desc' },
    });
  }

  async createEmailLog(data: any) {
    return prisma.pMSEmailLog.create({
      data,
    });
  }

  // --- Product IMF ---
  async getProductIMF(poNumber: string) {
    return prisma.pMSProductIMF.findUnique({
      where: { po_number: poNumber },
    });
  }

  async upsertProductIMF(poNumber: string, items: any) {
    return prisma.pMSProductIMF.upsert({
      where: { po_number: poNumber },
      create: { po_number: poNumber, items },
      update: { items },
    });
  }
}

export const pmsRepository = new PMSRepository();
