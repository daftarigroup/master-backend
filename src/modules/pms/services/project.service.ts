import { pmsRepository } from '../repositories/project.repository';
import { ApiError } from '../../../utils/ApiError';

export class PMSService {
  private parseDate(val: any): Date | null {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }

  // --- Projects ---
  async listProjects(user?: any, query?: any) {
    const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.administrate === true;
    let contractorNames: string[] | undefined;

    // Firm/contractor access scoping for non-admins if permittedFirms/firm_access exists
    if (!isSuperAdmin && user?.permittedFirms && user.permittedFirms.length > 0) {
      contractorNames = user.permittedFirms;
    }

    return pmsRepository.listProjects({
      search: query?.search as string,
      status: query?.status as string,
      contractorNames,
    });
  }

  async getProject(identifier: string) {
    const project = await pmsRepository.getProject(identifier);
    if (!project) {
      throw new ApiError(404, `Project not found with identifier: ${identifier}`);
    }
    return project;
  }

  async createProject(data: any) {
    const serialNo = (data.serial_no || data.serialNo || `PRJ-${Date.now().toString().slice(-6)}`).trim();
    const projectName = (data.project_name || data.projectName || '').trim();
    const projectType = (data.project_type || data.projectType || 'General Civil Works').trim();

    const projectData = {
      serial_no: serialNo,
      project_name: projectName,
      project_type: projectType,
      agreement_number: data.agreement_number || data.agreementNumber || null,
      department: data.department || null,
      division: data.division || null,
      sub_division: data.sub_division || data.subDivision || null,
      irrigation_capacity: data.irrigation_capacity || data.irrigationCapacity || null,
      project_location: data.project_location || data.projectLocation || null,
      village: data.village || null,
      district: data.district || null,
      state: data.state || null,
      contractor_name: data.contractor_name || data.contractorName || 'Pooja Construction',
      contractor_phone: data.contractor_phone || data.contractorPhone || null,
      contractor_email: data.contractor_email || data.contractorEmail || null,
      contractor_address: data.contractor_address || data.contractorAddress || null,
      sub_contractors: data.sub_contractors || data.subContractors || [],
      start_date: this.parseDate(data.start_date || data.startDate),
      planned_end_date: this.parseDate(data.planned_end_date || data.plannedEndDate),
      work_period: data.work_period || data.workPeriod || null,
      work_order: data.work_order || data.workOrder || null,
      work_order_date: this.parseDate(data.work_order_date || data.workOrderDate),
      work_order_document: data.work_order_document || data.workOrderDocument || null,
      work_order_doc_name: data.work_order_doc_name || data.workOrderDocumentName || null,
      tender_id: data.tender_id || data.tenderId || null,
      tender_amount: data.tender_amount !== undefined && data.tender_amount !== '' ? data.tender_amount : (data.tenderAmount !== undefined && data.tenderAmount !== '' ? data.tenderAmount : null),
      percentage: data.percentage !== undefined && data.percentage !== '' ? data.percentage : null,
      maintenance_period: data.maintenance_period || data.maintenancePeriod || null,
      project_description: data.project_description || data.projectDescription || null,
      status: data.status || 'Active',
    };

    return pmsRepository.createProject(projectData);
  }

  async updateProject(identifier: string, data: any) {
    const existing = await pmsRepository.findProjectByIdOrSerial(identifier);
    if (!existing) {
      throw new ApiError(404, `Project not found with identifier: ${identifier}`);
    }

    const updateData: any = {};
    if (data.project_name !== undefined || data.projectName !== undefined) updateData.project_name = data.project_name ?? data.projectName;
    if (data.project_type !== undefined || data.projectType !== undefined) updateData.project_type = data.project_type ?? data.projectType;
    if (data.agreement_number !== undefined || data.agreementNumber !== undefined) updateData.agreement_number = data.agreement_number ?? data.agreementNumber;
    if (data.department !== undefined) updateData.department = data.department;
    if (data.division !== undefined) updateData.division = data.division;
    if (data.sub_division !== undefined || data.subDivision !== undefined) updateData.sub_division = data.sub_division ?? data.subDivision;
    if (data.irrigation_capacity !== undefined || data.irrigationCapacity !== undefined) updateData.irrigation_capacity = data.irrigation_capacity ?? data.irrigationCapacity;
    if (data.project_location !== undefined || data.projectLocation !== undefined) updateData.project_location = data.project_location ?? data.projectLocation;
    if (data.village !== undefined) updateData.village = data.village;
    if (data.district !== undefined) updateData.district = data.district;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.contractor_name !== undefined || data.contractorName !== undefined) updateData.contractor_name = data.contractor_name ?? data.contractorName;
    if (data.contractor_phone !== undefined || data.contractorPhone !== undefined) updateData.contractor_phone = data.contractor_phone ?? data.contractorPhone;
    if (data.contractor_email !== undefined || data.contractorEmail !== undefined) updateData.contractor_email = data.contractor_email ?? data.contractorEmail;
    if (data.contractor_address !== undefined || data.contractorAddress !== undefined) updateData.contractor_address = data.contractor_address ?? data.contractorAddress;
    if (data.sub_contractors !== undefined || data.subContractors !== undefined) updateData.sub_contractors = data.sub_contractors ?? data.subContractors;
    if (data.start_date !== undefined || data.startDate !== undefined) updateData.start_date = this.parseDate(data.start_date ?? data.startDate);
    if (data.planned_end_date !== undefined || data.plannedEndDate !== undefined) updateData.planned_end_date = this.parseDate(data.planned_end_date ?? data.plannedEndDate);
    if (data.work_period !== undefined || data.workPeriod !== undefined) updateData.work_period = data.work_period ?? data.workPeriod;
    if (data.work_order !== undefined || data.workOrder !== undefined) updateData.work_order = data.work_order ?? data.workOrder;
    if (data.work_order_date !== undefined || data.workOrderDate !== undefined) updateData.work_order_date = this.parseDate(data.work_order_date ?? data.workOrderDate);
    if (data.work_order_document !== undefined || data.workOrderDocument !== undefined) updateData.work_order_document = data.work_order_document ?? data.workOrderDocument;
    if (data.work_order_doc_name !== undefined || data.workOrderDocumentName !== undefined) updateData.work_order_doc_name = data.work_order_doc_name ?? data.workOrderDocumentName;
    if (data.tender_id !== undefined || data.tenderId !== undefined) updateData.tender_id = data.tender_id ?? data.tenderId;
    if (data.tender_amount !== undefined || data.tenderAmount !== undefined) updateData.tender_amount = data.tender_amount ?? data.tenderAmount;
    if (data.percentage !== undefined) updateData.percentage = data.percentage;
    if (data.maintenance_period !== undefined || data.maintenancePeriod !== undefined) updateData.maintenance_period = data.maintenance_period ?? data.maintenancePeriod;
    if (data.project_description !== undefined || data.projectDescription !== undefined) updateData.project_description = data.project_description ?? data.projectDescription;
    if (data.status !== undefined) updateData.status = data.status;

    return pmsRepository.updateProject(existing.id, updateData);
  }

  async deleteProject(identifier: string) {
    const existing = await pmsRepository.findProjectByIdOrSerial(identifier);
    if (!existing) {
      throw new ApiError(404, `Project not found with identifier: ${identifier}`);
    }
    return pmsRepository.deleteProject(existing.id);
  }

  // --- Minors ---
  async listMinors(projectId: string) {
    return pmsRepository.listMinors(projectId);
  }

  async createMinor(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    const minorId = data.id || `M_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    return pmsRepository.createMinor({
      id: minorId,
      project_id: project.id,
      project_no: project.serial_no,
      minor_name: data.minor_name || data.minorName || 'Untitled Minor',
      contractor_name: data.contractor_name || data.contractorName || null,
      po_number: data.po_number || data.poNumber || null,
      schedule_file: data.schedule_file || data.scheduleFile || null,
      schedule_file_id: data.schedule_file_id || data.scheduleFileId || null,
      schedule_file_name: data.schedule_file_name || data.scheduleFileName || null,
      schedule_rows: data.schedule_rows || data.scheduleRows || null,
      schedule_headers: data.schedule_headers || data.scheduleHeaders || null,
    });
  }

  async updateMinor(minorId: string, data: any) {
    const existing = await pmsRepository.getMinor(minorId);
    if (!existing) throw new ApiError(404, `Minor not found: ${minorId}`);

    const updateData: any = {};
    if (data.minor_name !== undefined || data.minorName !== undefined) updateData.minor_name = data.minor_name ?? data.minorName;
    if (data.contractor_name !== undefined || data.contractorName !== undefined) updateData.contractor_name = data.contractor_name ?? data.contractorName;
    if (data.po_number !== undefined || data.poNumber !== undefined) updateData.po_number = data.po_number ?? data.poNumber;
    if (data.schedule_file !== undefined || data.scheduleFile !== undefined) updateData.schedule_file = data.schedule_file ?? data.scheduleFile;
    if (data.schedule_file_id !== undefined || data.scheduleFileId !== undefined) updateData.schedule_file_id = data.schedule_file_id ?? data.scheduleFileId;
    if (data.schedule_file_name !== undefined || data.scheduleFileName !== undefined) updateData.schedule_file_name = data.schedule_file_name ?? data.scheduleFileName;
    if (data.schedule_rows !== undefined || data.scheduleRows !== undefined) updateData.schedule_rows = data.schedule_rows ?? data.scheduleRows;
    if (data.schedule_headers !== undefined || data.scheduleHeaders !== undefined) updateData.schedule_headers = data.schedule_headers ?? data.scheduleHeaders;

    return pmsRepository.updateMinor(minorId, updateData);
  }

  async deleteMinor(minorId: string) {
    const existing = await pmsRepository.getMinor(minorId);
    if (!existing) throw new ApiError(404, `Minor not found: ${minorId}`);
    return pmsRepository.deleteMinor(minorId);
  }

  // --- Design ---
  async getDesign(projectId: string) {
    const design = await pmsRepository.getDesign(projectId);
    return design ? design.rows : [];
  }

  async upsertDesign(projectId: string, rows: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    return pmsRepository.upsertDesign(project, rows);
  }

  // --- Execution & Actuals ---
  async listExecutions(projectId: string, stageNumber?: number) {
    return pmsRepository.listExecutions(projectId, stageNumber);
  }

  async createExecution(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    return pmsRepository.createExecution({
      project_id: project.id,
      project_no: project.serial_no,
      entry_id: data.id || data.entry_id || null,
      date: this.parseDate(data.date),
      stage_number: data.stage_number !== undefined ? Number(data.stage_number) : (data.stageNumber !== undefined ? Number(data.stageNumber) : null),
      stage_name: data.stage_name || data.stageName || null,
      submission_date_time: data.submission_date_time || data.submissionDateTime || data.timestamp || null,
      data: data.data || data,
    });
  }

  async updateExecution(entryId: string, data: any) {
    return pmsRepository.updateExecution(entryId, {
      ...(data.date ? { date: this.parseDate(data.date) } : {}),
      ...(data.stage_number !== undefined ? { stage_number: Number(data.stage_number) } : {}),
      ...(data.stage_name ? { stage_name: data.stage_name } : {}),
      ...(data.data ? { data: data.data } : { data }),
    });
  }

  async deleteExecution(entryId: string) {
    return pmsRepository.deleteExecution(entryId);
  }

  async listActuals(projectId: string, stageNumber?: number) {
    return pmsRepository.listActuals(projectId, stageNumber);
  }

  async createActual(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    return pmsRepository.createActual({
      project_id: project.id,
      project_no: project.serial_no,
      entry_id: data.id || data.entry_id || null,
      date: this.parseDate(data.date),
      stage_number: data.stage_number !== undefined ? Number(data.stage_number) : (data.stageNumber !== undefined ? Number(data.stageNumber) : null),
      stage_name: data.stage_name || data.stageName || null,
      submission_date_time: data.submission_date_time || data.submissionDateTime || data.timestamp || null,
      data: data.data || data,
    });
  }

  async updateActual(entryId: string, data: any) {
    return pmsRepository.updateActual(entryId, {
      ...(data.date ? { date: this.parseDate(data.date) } : {}),
      ...(data.stage_number !== undefined ? { stage_number: Number(data.stage_number) } : {}),
      ...(data.stage_name ? { stage_name: data.stage_name } : {}),
      ...(data.data ? { data: data.data } : { data }),
    });
  }

  async deleteActual(entryId: string) {
    return pmsRepository.deleteActual(entryId);
  }

  // --- Stage Entries ---
  async listStageEntries(projectId: string, stageNumber?: number) {
    return pmsRepository.listStageEntries(projectId, stageNumber);
  }

  async upsertStageEntry(stageEntryId: string, data: any) {
    let projectId: bigint | undefined;
    let projectNo: string = data.project_no || data.projectNo || '';

    if (data.project_id || data.projectId) {
      projectId = BigInt(String(data.project_id || data.projectId));
    } else if (projectNo) {
      const proj = await pmsRepository.findProjectByIdOrSerial(projectNo);
      if (proj) {
        projectId = proj.id;
        projectNo = proj.serial_no;
      }
    }

    if (!projectId) {
      throw new ApiError(400, 'project_id or valid project_no is required for stage entry');
    }

    return pmsRepository.upsertStageEntry(stageEntryId, {
      project_id: projectId,
      project_no: projectNo,
      stage_number: Number(data.stage_number ?? data.stageNumber ?? 1),
      step_index: Number(data.step_index ?? data.stepIndex ?? 0),
      status: data.status || 'completed',
      data: data.data || data,
    });
  }

  // --- Contractor & Pipeline Stages ---
  async getFinalizeConsultant(projectId: string) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    return pmsRepository.getFinalizeConsultant(project.serial_no);
  }

  async upsertFinalizeConsultant(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    const consultants = Array.isArray(data) ? data : (data.consultants || []);
    return pmsRepository.upsertFinalizeConsultant(project.serial_no, consultants);
  }

  async getDrawingUpload(projectId: string) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    return pmsRepository.getDrawingUpload(project.serial_no);
  }

  async upsertDrawingUpload(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    const uploadData = {
      drawing_date: this.parseDate(data.drawing_date || data.drawingDate),
      drawing_file: data.drawing_file || data.drawingFile || null,
      drawing_file_name: data.drawing_file_name || data.drawingFileName || null,
      data: data.data || data,
    };
    return pmsRepository.upsertDrawingUpload(project.serial_no, uploadData);
  }

  async getFinalApproval(projectId: string) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    return pmsRepository.getFinalApproval(project.serial_no);
  }

  async upsertFinalApproval(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    const approvalData = {
      sub_division: Boolean(data.sub_division ?? data.subDivision),
      division: Boolean(data.division),
      circle_office: Boolean(data.circle_office ?? data.circleOffice),
      ceo_office: Boolean(data.ceo_office ?? data.ceoOffice),
      approval_date: this.parseDate(data.approval_date || data.approvalDate),
      remarks: data.remarks || null,
    };
    return pmsRepository.upsertFinalApproval(project.serial_no, approvalData);
  }

  async getDrawings(projectId: string) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    const res = await pmsRepository.getDrawings(project.serial_no);
    return res?.minors || [];
  }

  async upsertDrawings(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    const minors = Array.isArray(data) ? data : (data.minors || []);
    return pmsRepository.upsertDrawings(project.serial_no, minors);
  }

  // --- Material Requirements ---
  async listMaterialRequirements(projectId: string) {
    return pmsRepository.listMaterialRequirements(projectId);
  }

  async createMaterialRequirement(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    return pmsRepository.createMaterialRequirement({
      project_id: project.id,
      project_no: project.serial_no,
      indent_no: data.indent_no || data.indentNo || null,
      data: data.data || data,
    });
  }

  async deleteMaterialRequirement(reqId: string) {
    return pmsRepository.deleteMaterialRequirement(reqId);
  }

  // --- Schedules ---
  async getSchedule(minorId: string) {
    return pmsRepository.getSchedule(minorId);
  }

  async upsertSchedule(minorId: string, data: any) {
    const scheduleData = {
      file_id: data.file_id || data.fileId || null,
      file_url: data.file_url || data.fileUrl || null,
      file_name: data.file_name || data.fileName || null,
      rows: data.rows || null,
      headers: data.headers || null,
    };
    return pmsRepository.upsertSchedule(minorId, scheduleData);
  }

  // --- RM Bills ---
  async listRMBills(projectId: string, billType?: string) {
    return pmsRepository.listRMBills(projectId, billType);
  }

  async createRMBill(projectId: string, data: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    return pmsRepository.createRMBill({
      project_id: project.id,
      project_no: project.serial_no,
      bill_no: data.bill_no || data.billNo || null,
      rm_no: data.rm_no || data.rmNo || null,
      bill_type: data.bill_type || data.billType || 'Execution',
      bill_date: this.parseDate(data.bill_date || data.billDate),
      total_amount: data.total_amount !== undefined ? data.total_amount : (data.totalAmount !== undefined ? data.totalAmount : null),
      status: data.status || 'pending',
      remarks: data.remarks || null,
      entries: data.entries || [],
      calculations: data.calculations || null,
    });
  }

  async getRMBill(billId: string) {
    const bill = await pmsRepository.getRMBill(billId);
    if (!bill) throw new ApiError(404, `RM Bill not found with ID: ${billId}`);
    return bill;
  }

  async updateRMBill(billId: string, data: any) {
    const bill = await pmsRepository.getRMBill(billId);
    if (!bill) throw new ApiError(404, `RM Bill not found with ID: ${billId}`);

    const updateData: any = {};
    if (data.bill_no !== undefined || data.billNo !== undefined) updateData.bill_no = data.bill_no ?? data.billNo;
    if (data.rm_no !== undefined || data.rmNo !== undefined) updateData.rm_no = data.rm_no ?? data.rmNo;
    if (data.bill_type !== undefined || data.billType !== undefined) updateData.bill_type = data.bill_type ?? data.billType;
    if (data.bill_date !== undefined || data.billDate !== undefined) updateData.bill_date = this.parseDate(data.bill_date ?? data.billDate);
    if (data.total_amount !== undefined || data.totalAmount !== undefined) updateData.total_amount = data.total_amount ?? data.totalAmount;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.remarks !== undefined) updateData.remarks = data.remarks;
    if (data.entries !== undefined) updateData.entries = data.entries;
    if (data.calculations !== undefined) updateData.calculations = data.calculations;

    return pmsRepository.updateRMBill(billId, updateData);
  }

  async deleteRMBill(billId: string) {
    const bill = await pmsRepository.getRMBill(billId);
    if (!bill) throw new ApiError(404, `RM Bill not found with ID: ${billId}`);
    return pmsRepository.deleteRMBill(billId);
  }

  // --- Calculation State (Abstract, RA Planning, Final Comparative) ---
  async getCalcState(projectId: string, stateType: string) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);
    const rec = await pmsRepository.getCalcState(project.serial_no, stateType.toUpperCase());
    return rec ? rec.data : null;
  }

  async upsertCalcState(projectId: string, stateType: string, body: any) {
    const project = await pmsRepository.findProjectByIdOrSerial(projectId);
    if (!project) throw new ApiError(404, `Project not found with identifier: ${projectId}`);

    const stateData = body.data !== undefined ? body.data : body;
    return pmsRepository.upsertCalcState(
      project.serial_no,
      stateType.toUpperCase(),
      stateData,
      body.audit_logs || body.auditLogs,
      body.snapshots
    );
  }

  // --- Documents ---
  async listDocuments(projectNo?: string) {
    return pmsRepository.listDocuments(projectNo);
  }

  async createDocument(data: any) {
    const uid = data.document_uid || data.documentUid || data.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    return pmsRepository.createDocument({
      document_uid: uid,
      project_no: data.project_no || data.projectNo || null,
      project_name: data.project_name || data.projectName || null,
      agreement_no: data.agreement_no || data.agreementNo || null,
      title: data.title || data.fileName || 'Untitled Document',
      doc_type: data.doc_type || data.docType || 'General Document',
      file_name: data.file_name || data.fileName || 'document.pdf',
      file_url: data.file_url || data.fileUrl || '',
      file_size: data.file_size ? String(data.file_size) : (data.fileSize ? String(data.fileSize) : null),
      file_type: data.file_type || data.fileType || null,
      recipient: data.recipient || null,
      ref_no: data.ref_no || data.refNo || null,
      date: this.parseDate(data.date),
      remarks: data.remarks || null,
      uploaded_by: data.uploaded_by || data.uploadedBy || 'Admin',
    });
  }

  async deleteDocument(docId: string) {
    return pmsRepository.deleteDocument(docId);
  }

  // --- Email Logs ---
  async listEmailLogs(projectNo?: string) {
    return pmsRepository.listEmailLogs(projectNo);
  }

  async createEmailLog(data: any) {
    const uid = data.log_uid || data.id || `elog_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    return pmsRepository.createEmailLog({
      log_uid: uid,
      project_no: data.project_no || data.projectNo || null,
      project_name: data.project_name || data.projectName || null,
      agreement_no: data.agreement_no || data.agreementNo || null,
      to: data.to || '',
      cc: data.cc || null,
      subject: data.subject || '',
      body: data.body || null,
      attached_docs: data.attached_docs || data.attachedDocs || null,
      status: data.status || 'Sent',
      sender: data.sender || 'Pooja Construction Project Team',
    });
  }

  // --- Product IMF ---
  async getProductIMF(poNumber: string) {
    const rec = await pmsRepository.getProductIMF(poNumber);
    return rec ? rec.items : [];
  }

  async upsertProductIMF(poNumber: string, items: any) {
    const list = Array.isArray(items) ? items : (items?.items || []);
    return pmsRepository.upsertProductIMF(poNumber, list);
  }
}

export const pmsService = new PMSService();
