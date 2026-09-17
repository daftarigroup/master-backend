import { Request, Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { HrAuditService } from '../services/hrAudit.service';
import { loadIndents } from './indent.controller';

export class CandidateController {
  private formatCandidate(c: any) {
    let matchedIndent: any = null;
    try {
      if (c.indent_id) {
        const indents = loadIndents();
        matchedIndent = indents.find((i: any) => String(i.id) === String(c.indent_id)) || null;
      }
    } catch (_err) {}

    const vacancyTitle =
      matchedIndent?.title ||
      c.joining?.designation_offered ||
      c.employee?.designation ||
      c.previous_position ||
      null;

    return {
      ...c,
      id: c.id.toString(),
      indentId: c.indent_id || null,
      indent: matchedIndent,
      vacancyTitle,
      candidateEnquiryNo: c.candidate_enquiry_no,
      candidateName: c.candidate_name,
      dob: c.dob ? c.dob.toISOString().slice(0, 10) : null,
      phoneNo: c.phone_no,
      email: c.email || null,
      previousCompany: c.previous_company || null,
      experience: c.experience || null,
      previousPosition: c.previous_position || null,
      maritalStatus: c.marital_status || null,
      aadharNo: c.aadhar_no || null,
      lastSalary: c.last_salary || null,
      reasonForLeaving: c.reason_for_leaving || null,
      currentAddress: c.current_address || null,
      photo: c.photo || null,
      resume: c.resume || null,
      status: c.status,
      notes: c.notes || null,
      nextCallDate: c.next_call_date ? c.next_call_date.toISOString().slice(0, 10) : null,
      followUpNotes: c.follow_up_notes || null,
      callLogs: Array.isArray(c.call_logs) ? c.call_logs : [],
      documents: c.documents && typeof c.documents === 'object' ? c.documents : {},
      createdAt: c.created_at?.toISOString(),
      updatedAt: c.updated_at?.toISOString(),
      joining: c.joining
        ? {
            ...c.joining,
            id: c.joining.id.toString(),
            candidateId: c.joining.candidate_id?.toString(),
            joiningDate: c.joining.joining_date?.toISOString().slice(0, 10),
            monthlySalary: c.joining.monthly_salary ? Number(c.joining.monthly_salary) : null,
            offeredCTC: c.joining.offered_ctc,
            reportingManager: c.joining.reporting_manager,
            workLocation: c.joining.work_location,
            bankAccount: c.joining.bank_account,
            ifscCode: c.joining.ifsc_code,
            designationOffered: c.joining.designation_offered,
            probationMonths: c.joining.probation_months,
          }
        : null,
      employee: c.employee
        ? {
            id: c.employee.id.toString(),
            employeeId: c.employee.employee_id,
            empCode: c.employee.emp_code,
            name: c.employee.name,
            designation: c.employee.designation,
          }
        : null,
    };
  }

  /**
   * POST /candidate/history or GET /candidate
   */
  list = asyncHandler(async (req: Request, res: Response) => {
    const { status, indentId, search } = req.query as any;
    const where: any = {};

    if (status && status !== 'all') {
      where.status = status;
    }

    if (indentId) {
      where.indent_id = String(indentId);
    }

    if (search) {
      const q = String(search).trim();
      where.OR = [
        { candidate_name: { contains: q, mode: 'insensitive' } },
        { candidate_enquiry_no: { contains: q, mode: 'insensitive' } },
        { phone_no: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ];
    }

    const candidates = await prisma.hrCandidate.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        joining: true,
        employee: {
          select: { id: true, employee_id: true, emp_code: true, name: true, designation: true },
        },
      },
    });

    res.json({
      success: true,
      data: candidates.map((c: any) => this.formatCandidate(c)),
    });
  });

  /**
   * GET /candidate/:id
   */
  getById = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const candidate = await prisma.hrCandidate.findUnique({
      where: { id },
      include: {
        joining: true,
        employee: {
          select: { id: true, employee_id: true, emp_code: true, name: true, designation: true },
        },
      },
    });

    if (!candidate) {
      throw new ApiError(404, 'Candidate not found');
    }

    res.json({
      success: true,
      data: this.formatCandidate(candidate),
    });
  });

  /**
   * GET /candidate/by-indent/:indentId
   */
  getByIndent = asyncHandler(async (req: Request, res: Response) => {
    const indentId = req.params.indentId;
    const candidates = await prisma.hrCandidate.findMany({
      where: { indent_id: String(indentId) },
      orderBy: { created_at: 'desc' },
      include: {
        joining: true,
        employee: true,
      },
    });

    res.json({
      success: true,
      data: candidates.map((c: any) => this.formatCandidate(c)),
    });
  });

  /**
   * POST /candidate/submit
   */
  submit = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body;
    const year = new Date().getFullYear();
    const count = await prisma.hrCandidate.count();
    const candidateEnquiryNo = `ENQ-${year}-${String(count + 1).padStart(3, '0')}`;

    const candidate = await prisma.hrCandidate.create({
      data: {
        candidate_enquiry_no: candidateEnquiryNo,
        candidate_name: body.candidateName,
        dob: body.dob ? new Date(body.dob) : null,
        phone_no: body.phoneNo,
        email: body.email || null,
        previous_company: body.previousCompany || null,
        experience: body.experience || null,
        previous_position: body.previousPosition || null,
        marital_status: body.maritalStatus || null,
        aadhar_no: body.aadharNo || null,
        last_salary: body.lastSalary || null,
        reason_for_leaving: body.reasonForLeaving || null,
        current_address: body.currentAddress || null,
        indent_id: body.indentId ? String(body.indentId) : null,
        photo: body.photo || null,
        resume: body.resume || null,
        status: body.status || 'pending',
        notes: body.notes || null,
        next_call_date: body.nextCallDate ? new Date(body.nextCallDate) : null,
        follow_up_notes: body.followUpNotes || null,
      } as any,
    });

    await HrAuditService.log({
      entityType: 'candidate',
      entityId: candidate.id.toString(),
      eventType: 'CANDIDATE_CREATED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Enquiry submitted for ${candidate.candidate_name}`,
    });

    res.status(201).json({
      success: true,
      message: 'Candidate created successfully',
      data: this.formatCandidate(candidate),
    });
  });

  /**
   * PATCH /candidate/:id
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    const data: any = {};
    if (body.candidateName !== undefined) data.candidate_name = body.candidateName;
    if (body.dob !== undefined) data.dob = body.dob ? new Date(body.dob) : null;
    if (body.phoneNo !== undefined) data.phone_no = body.phoneNo;
    if (body.email !== undefined) data.email = body.email;
    if (body.previousCompany !== undefined) data.previous_company = body.previousCompany;
    if (body.experience !== undefined) data.experience = body.experience;
    if (body.previousPosition !== undefined) data.previous_position = body.previousPosition;
    if (body.maritalStatus !== undefined) data.marital_status = body.maritalStatus;
    if (body.aadharNo !== undefined) data.aadhar_no = body.aadharNo;
    if (body.lastSalary !== undefined) data.last_salary = body.lastSalary;
    if (body.reasonForLeaving !== undefined) data.reason_for_leaving = body.reasonForLeaving;
    if (body.currentAddress !== undefined) data.current_address = body.currentAddress;
    if (body.photo !== undefined) data.photo = body.photo;
    if (body.resume !== undefined) data.resume = body.resume;
    if (body.status !== undefined) data.status = body.status;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.nextCallDate !== undefined) data.next_call_date = body.nextCallDate ? new Date(body.nextCallDate) : null;
    if (body.followUpNotes !== undefined) data.follow_up_notes = body.followUpNotes;

    const updated = await prisma.hrCandidate.update({
      where: { id },
      data,
      include: { joining: true, employee: true },
    });

    res.json({
      success: true,
      message: 'Candidate updated successfully',
      data: this.formatCandidate(updated),
    });
  });

  /**
   * DELETE /candidate/:id
   */
  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    await prisma.hrCandidate.delete({ where: { id } });
    res.json({ success: true, message: 'Candidate deleted successfully' });
  });

  /**
   * POST /candidate/:id/log-call
   */
  logCall = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { status, notes } = req.body;

    const candidate = await prisma.hrCandidate.findUnique({ where: { id } });
    if (!candidate) throw new ApiError(404, 'Candidate not found');

    const logs = Array.isArray(candidate.call_logs) ? [...(candidate.call_logs as any[])] : [];
    const newEntry = {
      id: `call_${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      status,
      notes: notes || '',
      loggedBy: (req as any).user?.name || 'Admin',
      createdAt: new Date().toISOString(),
    };
    logs.unshift(newEntry);

    const updated = await prisma.hrCandidate.update({
      where: { id },
      data: {
        call_logs: logs,
        status: status || candidate.status,
        notes: notes ? `${candidate.notes ? candidate.notes + '\n' : ''}${notes}` : candidate.notes,
      },
      include: { joining: true, employee: true },
    });

    await HrAuditService.log({
      entityType: 'candidate',
      entityId: id.toString(),
      eventType: 'CANDIDATE_CALL_LOGGED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: `Call logged with status: ${status}`,
    });

    res.json({
      success: true,
      data: this.formatCandidate(updated),
    });
  });

  /**
   * POST /candidate/:id/initialize-joining
   */
  initializeJoining = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    const candidate = await prisma.hrCandidate.findUnique({
      where: { id },
      include: { joining: true },
    });
    if (!candidate) throw new ApiError(404, 'Candidate not found');

    const result = await prisma.$transaction(async (tx) => {
      // 1. Update candidate stage
      const candUpdated = await tx.hrCandidate.update({
        where: { id },
        data: { status: 'joining_initiated' },
      });

      // 2. Create or update HrJoining record
      const joiningData: any = {
        candidate_id: id,
        joining_date: new Date(body.joiningDate),
        status: 'pending',
        offered_ctc: body.offeredCTC,
        monthly_salary: body.monthlySalary ? Number(body.monthlySalary) : null,
        employment_type: body.employmentType || null,
        designation_offered: body.designationOffered || null,
        company_name: body.companyName || null,
        joining_place: body.joiningPlace || null,
        attendance_mode: body.attendanceMode || null,
        probation_months: body.probationMonths || 3,
        reporting_manager: body.reportingManager || null,
        work_location: body.workLocation || null,
        bank_account: body.bankAccount || null,
        bank_branch_name: body.bankBranchName || null,
        ifsc_code: body.ifscCode || null,
        payment_mode: body.paymentMode || null,
        emergency_contact_name: body.emergencyContactName || null,
        emergency_contact_phone: body.emergencyContactPhone || null,
        emergency_contact_relation: body.emergencyContactRelation || null,
        father_name: body.fatherName || null,
        highest_qualification: body.highestQualification || null,
        current_address: body.currentAddress || null,
        aadhar_address: body.aadharAddress || null,
        aadhar_no: body.aadharNo || null,
        email_to_be_issued: body.emailToBeIssued ?? false,
        mobile_to_be_issued: body.mobileToBeIssued ?? false,
        laptop_to_be_issued: body.laptopToBeIssued ?? false,
        pf_eligible: body.pfEligible ?? false,
        esic_eligible: body.esicEligible ?? false,
        past_pf_no: body.pastPfNo || null,
        esic_no: body.esicNo || null,
      };

      if (candidate.joining) {
        await tx.hrJoining.update({
          where: { id: candidate.joining.id },
          data: joiningData,
        });
      } else {
        await tx.hrJoining.create({
          data: joiningData,
        });
      }

      await HrAuditService.log(
        {
          entityType: 'candidate',
          entityId: id.toString(),
          eventType: 'JOINING_INITIATED',
          performedBy: (req as any).user?.name || 'Admin',
          notes: `Joining initiated with CTC: ${body.offeredCTC}`,
        },
        tx
      );

      return candUpdated;
    });

    const refreshed = await prisma.hrCandidate.findUnique({
      where: { id: result.id },
      include: { joining: true, employee: true },
    });

    res.json({
      success: true,
      message: 'Joining initiated successfully',
      data: this.formatCandidate(refreshed),
    });
  });

  /**
   * POST /candidate/:id/mark-joined
   */
  markJoined = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { joiningDate } = req.body;

    const candidate = await prisma.hrCandidate.findUnique({
      where: { id },
      include: { joining: true, employee: true },
    });
    if (!candidate) throw new ApiError(404, 'Candidate not found');

    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark candidate joined
      await tx.hrCandidate.update({
        where: { id },
        data: { status: 'joined' },
      });

      // 2. Mark joining record completed
      if (candidate.joining) {
        await tx.hrJoining.update({
          where: { id: candidate.joining.id },
          data: {
            status: 'completed',
            joining_date: joiningDate ? new Date(joiningDate) : candidate.joining.joining_date,
          },
        });
      }

      // 3. Create employee if not already existing
      let emp = candidate.employee;
      if (!emp) {
        const empCount = await tx.employee.count();
        const empCode = `EMP${String(empCount + 1).padStart(3, '0')}`;
        const joining = candidate.joining;

        emp = await tx.employee.create({
          data: {
            candidate_id: id,
            emp_code: empCode,
            name: candidate.candidate_name,
            phone: candidate.phone_no,
            email: candidate.email,
            designation: joining?.designation_offered || candidate.previous_position || 'Staff',
            status: 'active',
            joining_date: joiningDate ? new Date(joiningDate) : joining?.joining_date || new Date(),
            work_location: joining?.work_location || null,
            manager_name: joining?.reporting_manager || null,
            offered_ctc: joining?.offered_ctc || null,
            monthly_salary: joining?.monthly_salary || null,
            bank_account: joining?.bank_account || null,
            ifsc_code: joining?.ifsc_code || null,
            bank_branch_name: joining?.bank_branch_name || null,
            payment_mode: joining?.payment_mode || null,
            father_name: joining?.father_name || null,
            highest_qualification: joining?.highest_qualification || null,
            current_address: joining?.current_address || candidate.current_address || null,
            aadhar_address: joining?.aadhar_address || null,
            aadhar_no: joining?.aadhar_no || candidate.aadhar_no || null,
            emergency_contact_name: joining?.emergency_contact_name || null,
            emergency_contact_phone: joining?.emergency_contact_phone || null,
            emergency_contact_relation: joining?.emergency_contact_relation || null,
            email_to_be_issued: joining?.email_to_be_issued ?? false,
            mobile_to_be_issued: joining?.mobile_to_be_issued ?? false,
            laptop_to_be_issued: joining?.laptop_to_be_issued ?? false,
            pf_eligible: joining?.pf_eligible ?? false,
            esic_eligible: joining?.esic_eligible ?? false,
            past_pf_no: joining?.past_pf_no || null,
            esic_no: joining?.esic_no || null,
            offer_letter_issued: true,
          },
        });

        // Link joining to employeeId
        if (joining) {
          await tx.hrJoining.update({
            where: { id: joining.id },
            data: { employee_id: emp.employee_id },
          });
        }
      }

      await HrAuditService.log(
        {
          entityType: 'candidate',
          entityId: id.toString(),
          eventType: 'CANDIDATE_MARKED_JOINED',
          performedBy: (req as any).user?.name || 'Admin',
          notes: `Candidate marked as joined. Employee ID: ${emp.employee_id} (${emp.emp_code})`,
        },
        tx
      );

      return emp;
    });

    const refreshed = await prisma.hrCandidate.findUnique({
      where: { id },
      include: { joining: true, employee: true },
    });

    res.json({
      success: true,
      message: 'Candidate marked as joined and employee record created',
      data: this.formatCandidate(refreshed),
    });
  });

  /**
   * PATCH /candidate/:id/doc-verification
   */
  verifyDocuments = asyncHandler(async (req: Request, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { documents, notes, complete } = req.body;

    const candidate = await prisma.hrCandidate.findUnique({
      where: { id },
      include: { joining: true },
    });
    if (!candidate) throw new ApiError(404, 'Candidate not found');

    const currentDocs = candidate.documents && typeof candidate.documents === 'object' ? (candidate.documents as any) : {};
    const mergedDocs = { ...currentDocs, ...documents };

    if (candidate.joining?.id) {
      await prisma.hrJoining.update({
        where: { id: candidate.joining.id },
        data: {
          documents: mergedDocs,
          ...(complete ? { status: 'docs_verified' } : {}),
        },
      }).catch((err) => console.warn('Failed to update hrJoining documents:', err));
    }

    const updated = await prisma.hrCandidate.update({
      where: { id },
      data: {
        documents: mergedDocs,
        notes: notes ? `${candidate.notes ? candidate.notes + '\n' : ''}${notes}` : candidate.notes,
      },
      include: { joining: true, employee: true },
    });

    await HrAuditService.log({
      entityType: 'candidate',
      entityId: id.toString(),
      eventType: complete ? 'DOCUMENTS_COMPLETED' : 'DOCUMENTS_VERIFIED',
      performedBy: (req as any).user?.name || 'Admin',
      notes: complete
        ? 'Document verification completed and verified'
        : 'Document verification checklist saved',
    });

    res.json({
      success: true,
      message: complete ? 'Document verification completed' : 'Documents updated successfully',
      data: this.formatCandidate(updated),
    });
  });
}
