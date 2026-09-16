import { Router } from 'express';
import { prisma } from '../../../database/prisma';
import { validate } from '../../../middleware/validate.middleware';
import { requireRole } from '../../checklist/middleware/requireRole.middleware';
import { scopeToFirmAccess } from '../../checklist/middleware/scopeToFirmAccess.middleware';

// Controllers
import { DeploymentController } from '../controllers/deployment.controller';
import { EmployeeController } from '../controllers/employee.controller';
import { IndentController } from '../controllers/indent.controller';
import { CandidateController } from '../controllers/candidate.controller';
import { JoiningController } from '../controllers/joining.controller';
import { AttendanceController } from '../controllers/attendance.controller';
import { LeaveController } from '../controllers/leave.controller';
import { GatePassController } from '../controllers/gatepass.controller';
import { SalaryController } from '../controllers/salary.controller';
import { SocialController } from '../controllers/social.controller';
import { AdvanceController } from '../controllers/advance.controller';
import { LeavingController } from '../controllers/leaving.controller';
import { LetterController } from '../controllers/letter.controller';
import { DashboardController } from '../controllers/dashboard.controller';
import { UploadController } from '../../store/controllers/upload.controller';

// Validators
import {
  createAssignmentSchema,
  shiftAssignmentSchema,
  leaveAssignmentSchema,
  resumeAssignmentSchema,
  removeAssignmentSchema,
  completeAssignmentSchema,
} from '../validators/deployment.validator';
import {
  submitCandidateSchema,
  updateCandidateSchema,
  logCallSchema,
  initializeJoiningSchema,
  docVerificationSchema,
} from '../validators/candidate.validator';
import {
  initiateJoiningRouteSchema,
  updateJoiningRouteSchema,
  onboardingUpdateSchema,
  checklistConfigSchema,
  bulkImportSchema,
} from '../validators/joining.validator';
import {
  upsertAttendanceSchema,
  updateAttendanceConfigSchema,
  submitClaimSchema,
  adminSubmitClaimSchema,
  claimReviewSchema,
} from '../validators/attendance.validator';
import { submitLeaveSchema, updateLeaveStatusSchema } from '../validators/leave.validator';
import { issueGatePassSchema, updateGatePassStatusSchema } from '../validators/gatepass.validator';
import {
  upsertStructureSchema,
  previewStructureSchema,
  holdSalarySchema,
  generatePayslipSchema,
  payPolicySchema,
} from '../validators/salary.validator';
import { connectAccountSchema, syncAccountSchema } from '../validators/social.validator';
import {
  submitAdvanceRequestSchema,
  updateAdvanceStatusSchema,
  updateAdvanceRequestSchema,
} from '../validators/advance.validator';
import { recordResignationSchema, processExitSchema } from '../validators/leaving.validator';
import {
  createTemplateSchema,
  updateTemplateSchema,
  saveFieldValuesSchema,
} from '../validators/letter.validator';

const router = Router();

// Instantiate controllers
const deploymentController = new DeploymentController();
const employeeController = new EmployeeController();
const indentController = new IndentController();
const candidateController = new CandidateController();
const joiningController = new JoiningController();
const attendanceController = new AttendanceController();
const leaveController = new LeaveController();
const gatePassController = new GatePassController();
const salaryController = new SalaryController();
const socialController = new SocialController();
const advanceController = new AdvanceController();
const leavingController = new LeavingController();
const letterController = new LetterController();
const dashboardController = new DashboardController();
const uploadController = new UploadController();

const ANY_ROLE = ['SUPER_ADMIN', 'ADMIN', 'USER'] as const;
const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

// ==================== DASHBOARD ENDPOINTS ====================
router.get(['/dashboard/stats', '/stats'], requireRole(...ANY_ROLE), scopeToFirmAccess, dashboardController.stats);

// ==================== USERS / MANAGERS / HODS ====================
router.get(['/managers', '/hods', '/users'], requireRole(...ANY_ROLE), async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      include: {
        employee: {
          include: { department: true },
        },
      },
    });

    const data = users
      .filter((u: any) => u.name || u.user_name)
      .map((u: any) => ({
        id: String(u.id),
        name: u.name || u.user_name,
        userName: u.user_name || null,
        email: u.user_name ? `${u.user_name}@master.com` : null,
        department: u.employee?.department?.name || null,
        employeeId: u.employee?.employee_id || null,
        empCode: u.employee?.emp_code || null,
      }));

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// ==================== HR INDENT / JOB REQUISITION ENDPOINTS ====================
router.get(['/indent/get-pending', '/indents/get-pending'], indentController.getPending);
router.get(['/indent', '/indents'], indentController.getAll);
router.get(['/indent/:id', '/indents/:id'], indentController.getOne);
router.post(['/indent', '/indents'], indentController.create);
router.patch(['/indent/:id', '/indents/:id'], indentController.update);
router.delete(['/indent/:id', '/indents/:id'], indentController.delete);

// ==================== CANDIDATE PIPELINE & ENQUIRY ====================
router.post(['/candidate/history', '/candidates/history'], requireRole(...ANY_ROLE), candidateController.list);
router.get(['/candidate', '/candidates'], requireRole(...ANY_ROLE), candidateController.list);
router.get(['/candidate/by-indent/:indentId', '/candidates/by-indent/:indentId'], requireRole(...ANY_ROLE), candidateController.getByIndent);
router.get(['/candidate/:id', '/candidates/:id'], requireRole(...ANY_ROLE), candidateController.getById);
router.post(['/candidate/submit', '/candidates/submit', '/candidate', '/candidates'], requireRole(...ANY_ROLE), validate(submitCandidateSchema), candidateController.submit);
router.patch(['/candidate/:id', '/candidates/:id'], requireRole(...ANY_ROLE), validate(updateCandidateSchema), candidateController.update);
router.delete(['/candidate/:id', '/candidates/:id'], requireRole(...ADMIN_ROLES), candidateController.delete);
router.post(['/candidate/:id/log-call', '/candidates/:id/log-call'], requireRole(...ANY_ROLE), validate(logCallSchema), candidateController.logCall);
router.post(['/candidate/:id/initialize-joining', '/candidates/:id/initialize-joining'], requireRole(...ADMIN_ROLES), validate(initializeJoiningSchema), candidateController.initializeJoining);
router.post(['/candidate/:id/mark-joined', '/candidates/:id/mark-joined'], requireRole(...ADMIN_ROLES), candidateController.markJoined);
router.patch(['/candidate/:id/doc-verification', '/candidates/:id/doc-verification'], requireRole(...ADMIN_ROLES), validate(docVerificationSchema), candidateController.verifyDocuments);

// ==================== JOINING & ONBOARDING ====================
router.get(['/joining', '/joinings'], requireRole(...ANY_ROLE), joiningController.list);
router.post(['/joining/initiate', '/joinings/initiate'], requireRole(...ADMIN_ROLES), validate(initiateJoiningRouteSchema), joiningController.initiate);
router.put(['/joining/:id', '/joinings/:id'], requireRole(...ADMIN_ROLES), validate(updateJoiningRouteSchema), joiningController.update);

// Employee onboarding & checklist config (must be before /employees/:id)
router.get(['/employees/checklist-config', '/employee/checklist-config'], requireRole(...ANY_ROLE), joiningController.getChecklistConfig);
router.patch(['/employees/checklist-config', '/employee/checklist-config'], requireRole(...ADMIN_ROLES), validate(checklistConfigSchema), joiningController.saveChecklistConfig);
router.get(['/employees/onboarding', '/employee/onboarding'], requireRole(...ANY_ROLE), joiningController.getOnboardingList);
router.patch(['/employees/:id/onboarding', '/employee/:id/onboarding'], requireRole(...ADMIN_ROLES), validate(onboardingUpdateSchema), joiningController.updateOnboarding);
router.post(['/employees/bulk-import', '/employee/bulk-import'], requireRole(...ADMIN_ROLES), validate(bulkImportSchema), joiningController.bulkImport);
router.get(['/employees/joined-without-account', '/employee/joined-without-account'], requireRole(...ANY_ROLE), joiningController.getJoinedWithoutAccount);

// ==================== ATTENDANCE MANAGEMENT ====================
router.get(['/attendance/shifts'], requireRole(...ANY_ROLE), attendanceController.getShifts);
router.get(['/attendance/today'], requireRole(...ANY_ROLE), attendanceController.getToday);
router.get(['/attendance/daily'], requireRole(...ANY_ROLE), attendanceController.getDaily);
router.get(['/attendance/monthly'], requireRole(...ANY_ROLE), attendanceController.getMonthly);
router.get(['/attendance/my-monthly'], requireRole(...ANY_ROLE), attendanceController.getMonthly);
router.get(['/attendance/monthly-summary'], requireRole(...ANY_ROLE), attendanceController.getMonthlySummary);
router.get(['/attendance/config'], requireRole(...ANY_ROLE), attendanceController.getConfig);
router.put(['/attendance/config'], requireRole(...ADMIN_ROLES), validate(updateAttendanceConfigSchema), attendanceController.updateConfig);
router.post(['/attendance/checkin'], requireRole(...ANY_ROLE), attendanceController.checkin);
router.patch(['/attendance/checkout'], requireRole(...ANY_ROLE), attendanceController.checkout);
router.post(['/attendance/punch'], requireRole(...ADMIN_ROLES), attendanceController.submitPunch);
router.get(['/attendance/punches'], requireRole(...ANY_ROLE), attendanceController.listPunches);

// Attendance claims
router.post(['/attendance/claims/admin-submit'], requireRole(...ADMIN_ROLES), validate(adminSubmitClaimSchema), attendanceController.adminSubmitClaim);
router.post(['/attendance/claims'], requireRole(...ANY_ROLE), validate(submitClaimSchema), attendanceController.submitClaim);
router.get(['/attendance/claims/my'], requireRole(...ANY_ROLE), attendanceController.getMyClaims);
router.get(['/attendance/claims'], requireRole(...ANY_ROLE), attendanceController.getAllClaims);
router.patch(['/attendance/claims/:id/approve'], requireRole(...ADMIN_ROLES), validate(claimReviewSchema), attendanceController.approveClaim);
router.patch(['/attendance/claims/:id/reject'], requireRole(...ADMIN_ROLES), validate(claimReviewSchema), attendanceController.rejectClaim);
router.patch(['/attendance/claims/:id/edit-review'], requireRole(...ADMIN_ROLES), validate(claimReviewSchema), attendanceController.editReviewClaim);

// Attendance CRUD
router.post(['/attendance'], requireRole(...ADMIN_ROLES), validate(upsertAttendanceSchema), attendanceController.upsert);
router.patch(['/attendance/:id'], requireRole(...ADMIN_ROLES), attendanceController.update);

// ==================== LEAVE MANAGEMENT ====================
router.get(['/leave/approvals/pending', '/leaves/approvals/pending'], requireRole(...ANY_ROLE), leaveController.getPendingApprovals);
router.get(['/leave/employee/:employeeId', '/leaves/employee/:employeeId'], requireRole(...ANY_ROLE), leaveController.getByEmployee);
router.get(['/leave/:id/task-impact', '/leaves/:id/task-impact'], requireRole(...ANY_ROLE), leaveController.getTaskImpact);
router.get(['/leave/:id', '/leaves/:id'], requireRole(...ANY_ROLE), leaveController.getById);
router.get(['/leave', '/leaves'], requireRole(...ANY_ROLE), leaveController.list);
router.post(['/leave/submit', '/leaves/submit', '/leave', '/leaves'], requireRole(...ANY_ROLE), validate(submitLeaveSchema), leaveController.submit);
router.patch(['/leave/:id/status', '/leaves/:id/status'], requireRole(...ADMIN_ROLES), validate(updateLeaveStatusSchema), leaveController.updateStatus);
router.delete(['/leave/:id', '/leaves/:id'], requireRole(...ADMIN_ROLES), leaveController.delete);

// ==================== GATE PASS MANAGEMENT ====================
router.get(['/gatepass/stats', '/gate-pass/stats'], requireRole(...ANY_ROLE), gatePassController.stats);
router.get(['/gatepass/employee/:employeeId', '/gate-pass/employee/:employeeId'], requireRole(...ANY_ROLE), gatePassController.getByEmployee);
router.get(['/gatepass/:id', '/gate-pass/:id'], requireRole(...ANY_ROLE), gatePassController.getById);
router.get(['/gatepass', '/gate-pass'], requireRole(...ANY_ROLE), gatePassController.list);
router.post(['/gatepass/issue', '/gatepass', '/gate-pass/issue', '/gate-pass'], requireRole(...ANY_ROLE), validate(issueGatePassSchema), gatePassController.issue);
router.patch(['/gatepass/:id/status', '/gate-pass/:id/status'], requireRole(...ANY_ROLE), validate(updateGatePassStatusSchema), gatePassController.updateStatus);
router.delete(['/gatepass/:id', '/gate-pass/:id'], requireRole(...ADMIN_ROLES), gatePassController.delete);

// ==================== ADVANCE & LOAN APPROVAL ====================
router.get(['/advance-request/stats', '/advance/stats'], requireRole(...ANY_ROLE), advanceController.stats);
router.get(['/advance-request/employee/:employeeId', '/advance/employee/:employeeId'], requireRole(...ANY_ROLE), advanceController.getByEmployee);
router.get(['/advance-request/:id/loan-history', '/advance/:id/loan-history'], requireRole(...ANY_ROLE), advanceController.getLoanHistory);
router.get(['/advance-request/:id', '/advance/:id'], requireRole(...ANY_ROLE), advanceController.getById);
router.get(['/advance-request', '/advance'], requireRole(...ANY_ROLE), advanceController.list);
router.post(['/advance-request/submit', '/advance-request', '/advance/submit', '/advance'], requireRole(...ANY_ROLE), validate(submitAdvanceRequestSchema), advanceController.submit);
router.patch(['/advance-request/:id/status', '/advance/:id/status'], requireRole(...ADMIN_ROLES), validate(updateAdvanceStatusSchema), advanceController.updateStatus);
router.patch(['/advance-request/:id/complete', '/advance/:id/complete'], requireRole(...ADMIN_ROLES), advanceController.markComplete);
router.patch(['/advance-request/loan/:loanId/settle', '/advance/loan/:loanId/settle'], requireRole(...ADMIN_ROLES), advanceController.settleLoan);
router.patch(['/advance-request/:id', '/advance/:id'], requireRole(...ADMIN_ROLES), validate(updateAdvanceRequestSchema), advanceController.update);
router.delete(['/advance-request/:id', '/advance/:id'], requireRole(...ADMIN_ROLES), advanceController.delete);

// ==================== SALARY & PAYROLL MANAGEMENT ====================
router.get(['/salary/payroll'], requireRole(...ANY_ROLE), salaryController.getPayroll);
router.get(['/salary/structure'], requireRole(...ANY_ROLE), salaryController.getGlobalStructure);
router.post(['/salary/structure'], requireRole(...ADMIN_ROLES), salaryController.saveGlobalStructure);
router.get(['/salary/structure/employee/:employeeId'], requireRole(...ANY_ROLE), salaryController.getEmployeeStructure);
router.post(['/salary/structure/employee/:employeeId'], requireRole(...ADMIN_ROLES), validate(upsertStructureSchema), salaryController.upsertEmployeeStructure);
router.post(['/salary/structure/preview'], requireRole(...ANY_ROLE), validate(previewStructureSchema), salaryController.previewStructure);
router.get(['/salary/policy'], requireRole(...ANY_ROLE), salaryController.getPayPolicy);
router.post(['/salary/policy'], requireRole(...ADMIN_ROLES), validate(payPolicySchema), salaryController.savePayPolicy);
router.patch(['/salary/hold/:employeeId'], requireRole(...ADMIN_ROLES), validate(holdSalarySchema), salaryController.holdSalary);
router.post(['/salary/payslips/generate'], requireRole(...ADMIN_ROLES), validate(generatePayslipSchema), salaryController.generatePayslip);
router.get(['/salary/payslips/me'], requireRole(...ANY_ROLE), salaryController.getMyPayslips);
router.get(['/salary/payslips/:employeeId'], requireRole(...ANY_ROLE), salaryController.getEmployeePayslips);
router.patch(['/salary/payslip/:id/mark-paid'], requireRole(...ADMIN_ROLES), salaryController.markPaid);
router.delete(['/salary/payslip/:id'], requireRole(...ADMIN_ROLES), salaryController.deletePayslip);
router.get(['/salary/employees'], requireRole(...ANY_ROLE), salaryController.getSalaryEmployees);
router.get(['/salary/employee-loans/:employeeId'], requireRole(...ANY_ROLE), salaryController.getEmployeeLoans);
router.get(['/salary/all-transactions'], requireRole(...ANY_ROLE), salaryController.getAllTransactions);

// ==================== SOCIAL POSTING ====================
router.get(['/social/accounts'], requireRole(...ANY_ROLE), socialController.listAccounts);
router.post(['/social/accounts/connect'], requireRole(...ADMIN_ROLES), validate(connectAccountSchema), socialController.connectAccount);
router.patch(['/social/accounts/:id/disconnect'], requireRole(...ADMIN_ROLES), socialController.disconnectAccount);
router.patch(['/social/accounts/:id/reconnect'], requireRole(...ADMIN_ROLES), socialController.reconnectAccount);
router.post(['/social/accounts/:id/sync'], requireRole(...ADMIN_ROLES), validate(syncAccountSchema), socialController.syncAccount);

// ==================== AFTER-LEAVING WORK ====================
router.get(['/leaving', '/leaving/all'], requireRole(...ANY_ROLE), leavingController.listLeaving);
router.get(['/leaving/my-status'], requireRole(...ANY_ROLE), leavingController.myStatus);
router.post(['/leaving/resign', '/employee/resign', '/employees/resign'], requireRole(...ANY_ROLE), validate(recordResignationSchema), leavingController.resign);
router.patch(['/leaving/:id', '/employee/:id/process-exit', '/employees/:id/process-exit'], requireRole(...ADMIN_ROLES), validate(processExitSchema), leavingController.processExit);
router.patch(['/employee/:id/deactivate-user', '/employees/:id/deactivate-user'], requireRole(...ADMIN_ROLES), leavingController.deactivateUser);

// ==================== LETTER FORMATTER ====================
router.get(['/letter-template/:id/field-values'], requireRole(...ANY_ROLE), letterController.getFieldValues);
router.post(['/letter-template/:id/field-values'], requireRole(...ADMIN_ROLES), validate(saveFieldValuesSchema), letterController.saveFieldValues);
router.get(['/letter-template/:id/render'], requireRole(...ANY_ROLE), letterController.render);
router.get(['/letter-template/:id'], requireRole(...ANY_ROLE), letterController.getById);
router.get(['/letter-template'], requireRole(...ANY_ROLE), letterController.list);
router.post(['/letter-template'], requireRole(...ADMIN_ROLES), validate(createTemplateSchema), letterController.create);
router.patch(['/letter-template/:id'], requireRole(...ADMIN_ROLES), validate(updateTemplateSchema), letterController.update);
router.delete(['/letter-template/:id'], requireRole(...ADMIN_ROLES), letterController.delete);

// ==================== EMPLOYEE CRUD ENDPOINTS ====================
router.get(['/employees/stats', '/employee/stats'], requireRole(...ANY_ROLE), scopeToFirmAccess, employeeController.stats);
router.get(['/employees/leaving', '/employee/leaving'], requireRole(...ANY_ROLE), scopeToFirmAccess, employeeController.leaving);
router.get(['/employees', '/employee', '/attendance/employees'], requireRole(...ANY_ROLE), scopeToFirmAccess, employeeController.list);
router.post(['/employees', '/employee'], requireRole(...ADMIN_ROLES), scopeToFirmAccess, employeeController.create);
router.patch(['/employees/:id/leaving', '/employee/:id/leaving'], requireRole(...ADMIN_ROLES), scopeToFirmAccess, employeeController.recordSeparation);
router.get(['/employees/:id', '/employee/:id'], requireRole(...ANY_ROLE), scopeToFirmAccess, employeeController.getById);
router.patch(['/employees/:id', '/employee/:id'], requireRole(...ADMIN_ROLES), scopeToFirmAccess, employeeController.update);
router.delete(['/employees/:id', '/employee/:id'], requireRole(...ADMIN_ROLES), scopeToFirmAccess, employeeController.delete);

// ==================== ASSIGNMENT READ ENDPOINTS ====================
router.get('/assignments', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.list);
router.get('/project-assignment', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.list);
router.get('/assignments/active', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getActive);
router.get('/project-assignment/active', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getActive);
router.get('/assignments/events', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getEvents);
router.get('/project-assignment/events', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getEvents);
router.get('/assignments/employee/:employeeId', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getEmployeeHistory);
router.get('/assignments/:id', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getById);
router.get('/project-assignment/:id', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getById);
router.get('/assignments/:id/events', requireRole(...ANY_ROLE), scopeToFirmAccess, deploymentController.getAssignmentEvents);

// ==================== ASSIGNMENT MUTATION ENDPOINTS ====================
router.post('/assignments', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(createAssignmentSchema), deploymentController.assign);
router.post('/project-assignment', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(createAssignmentSchema), deploymentController.assign);
router.post('/assignments/:id/shift', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(shiftAssignmentSchema), deploymentController.shift);
router.patch('/assignments/:id/shift', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(shiftAssignmentSchema), deploymentController.shift);
router.post('/project-assignment/:id/shift', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(shiftAssignmentSchema), deploymentController.shift);
router.patch('/project-assignment/:id/shift', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(shiftAssignmentSchema), deploymentController.shift);
router.post('/assignments/:id/leave', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(leaveAssignmentSchema), deploymentController.leave);
router.patch('/assignments/:id/leave', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(leaveAssignmentSchema), deploymentController.leave);
router.post('/project-assignment/:id/leave', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(leaveAssignmentSchema), deploymentController.leave);
router.patch('/project-assignment/:id/leave', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(leaveAssignmentSchema), deploymentController.leave);
router.post('/assignments/:id/resume', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(resumeAssignmentSchema), deploymentController.resume);
router.patch('/assignments/:id/resume', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(resumeAssignmentSchema), deploymentController.resume);
router.post('/project-assignment/:id/resume', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(resumeAssignmentSchema), deploymentController.resume);
router.patch('/project-assignment/:id/resume', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(resumeAssignmentSchema), deploymentController.resume);
router.post('/assignments/:id/remove', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(removeAssignmentSchema), deploymentController.remove);
router.patch('/assignments/:id/remove', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(removeAssignmentSchema), deploymentController.remove);
router.post('/project-assignment/:id/remove', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(removeAssignmentSchema), deploymentController.remove);
router.patch('/project-assignment/:id/remove', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(removeAssignmentSchema), deploymentController.remove);
router.post('/assignments/:id/complete', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(completeAssignmentSchema), deploymentController.complete);
router.patch('/assignments/:id/complete', requireRole(...ADMIN_ROLES), scopeToFirmAccess, validate(completeAssignmentSchema), deploymentController.complete);

// ==================== S3 UPLOAD & FILE SERVING ENDPOINTS FOR HR ====================
router.post(['/upload/presign', '/store/upload/presign'], uploadController.presignUpload);
router.delete(['/upload', '/store/upload'], uploadController.deleteUpload);
router.get(['/file-proxy', '/store/file-proxy'], uploadController.getFile);
router.get(['/files/*filePath', '/store/files/*filePath'], uploadController.getFile);

// Fallback handler for unmigrated routes
router.use((req, res) => {
  res.json({
    success: true,
    data: [],
    message: `Endpoint ${req.method} ${req.originalUrl} not found or not yet registered`,
  });
});

export default router;
