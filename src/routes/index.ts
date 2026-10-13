import { Router } from 'express';
import storeRoutes from '../modules/store/routes/store.routes';
import emailRoutes from './email.routes';
import checklistRoutes from '../modules/checklist/routes/checklist.routes';
import pettyCashRoutes from '../modules/petty-cash/routes/pettyCash.routes';
import documentRoutes from '../modules/document/routes/document.routes';
import hrRoutes from '../modules/hr/routes/hr.routes';
import assetRoutes from '../modules/asset/routes/asset.routes';
import { assetController } from '../modules/asset/controllers/asset.controller';
import maintenanceRoutes from '../modules/maintenance/routes/maintenance.routes';
import repairRoutes from '../modules/repair/routes/repair.routes';
import fleetRoutes from '../modules/fleet/routes/fleet.routes';
import { authenticateJWT, requireLogin } from '../middleware/auth.middleware';
import { getAwsConfigStatus } from '../config';
import { prisma } from '../database/prisma';
import { UserController } from '../modules/store/controllers/user.controller';
import { CandidateController } from '../modules/hr/controllers/candidate.controller';
import { AttendanceController } from '../modules/hr/controllers/attendance.controller';
import { UploadController } from '../modules/store/controllers/upload.controller';
import { validate } from '../middleware/validate.middleware';
import { submitCandidateSchema } from '../modules/hr/validators/candidate.validator';

const router = Router();
const userController = new UserController();
const candidateController = new CandidateController();
const attendanceController = new AttendanceController();
const uploadController = new UploadController();

router.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    s3: getAwsConfigStatus(),
  });
});

// Public Asset Verification (for mobile QR code scanning without authentication)
router.get('/public/assets/:id', assetController.getPublic);

// Public HR Candidate Application (for mobile QR code scanning without authentication)
router.get(['/public/hr/indent/:id', '/hr/public/indent/:id', '/hrfms/public/indent/:id'], candidateController.getPublicIndent);
router.post(['/public/hr/apply', '/hr/public/apply', '/hrfms/public/apply'], validate(submitCandidateSchema), candidateController.submitPublic);

// Public Attendance Kiosk & QR Punching (no login required)
router.get(['/public/attendance/employees', '/hr/public/attendance/employees', '/hrfms/public/attendance/employees'], async (_req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        employee_id: true,
        emp_code: true,
        name: true,
        email: true,
        designation: true,
        department: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    res.json({
      success: true,
      data: employees.map((e: any) => ({
        id: e.id.toString(),
        employeeId: e.employee_id,
        empCode: e.emp_code,
        name: e.name,
        email: e.email,
        designation: e.designation,
        department: e.department ? { id: Number(e.department.id), name: e.department.name } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});
router.post(['/public/attendance/upload/presign', '/hr/public/attendance/upload/presign', '/hrfms/public/attendance/upload/presign'], uploadController.presignUpload);
router.post(['/public/attendance/punch', '/hr/public/attendance/punch', '/hrfms/public/attendance/punch'], attendanceController.submitPunch);
router.get(['/public/attendance/punches', '/hr/public/attendance/punches', '/hrfms/public/attendance/punches'], attendanceController.listPunches);

router.use('/store', storeRoutes);
router.use('/email', emailRoutes);
router.use('/checklist', authenticateJWT, checklistRoutes);
router.use('/petty-cash', authenticateJWT, pettyCashRoutes);
router.use('/document', authenticateJWT, documentRoutes);
router.use('/doc-submanager', authenticateJWT, documentRoutes);
router.use('/hr', authenticateJWT, hrRoutes);
router.use('/hrfms', authenticateJWT, hrRoutes);
router.use('/assets', authenticateJWT, requireLogin, assetRoutes);
router.use('/maintenance', authenticateJWT, requireLogin, maintenanceRoutes);
router.use('/repair-system', authenticateJWT, requireLogin, repairRoutes);
router.use('/fleet', authenticateJWT, fleetRoutes);
// /assets, /maintenance, /repair-system and /user/list are for logged-in users only: before this, a request with no token reached
// them with no user (approve / transfer / mark-done accepted anonymous calls). The public QR route above stays open.

// Assignee picker shared by Maintenance's assign/transfer/breakdown-assignee UIs —
// {id, name, email, role, employeeId}, matching AssignableUser in the frontend.
router.get('/user/list', authenticateJWT, requireLogin, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, user_name: true, role: true, employee: { select: { employee_id: true, designation: true, phone: true } } },
    });
    res.json({
      success: true,
      data: users.map((u: any) => ({
        id: String(u.id),
        name: u.name || u.user_name || 'User',
        email: '',
        role: u.role || 'USER',
        employeeId: u.employee?.employee_id ?? null,
        // read from the Employee record (not duplicated on the user); logged-in users only
        designation: u.employee?.designation ?? null,
        phone: u.employee?.phone ?? null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// Shared maintenance departments for HR & system-wide dropdowns
router.get(['/maintenance/departments', '/departments'], async (_req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: { name: 'asc' },
    });
    res.json({
      status: 'success',
      data: departments.map((d: any) => ({
        id: d.id.toString(),
        name: d.name,
        code: null,
        status: 'ACTIVE',
      })),
      pagination: {
        total: departments.length,
        limit: 200,
        page: 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Shared firms / projects for Asset, Maintenance & Repair systems
router.get(['/maintenance/firms', '/firms', '/projects'], async (_req, res, next) => {
  try {
    const firms = await prisma.firm.findMany({
      where: { active: true },
      orderBy: { firm_name: 'asc' },
    });
    res.json({
      status: 'success',
      data: firms.map((f: any) => ({
        id: f.id.toString(),
        name: f.firm_name,
        code: f.id.toString(),
        billingAddress: f.billing_address || null,
        destinationAddress: f.destination_address || null,
        contactPerson: f.contact_person || null,
        active: f.active,
      })),
      pagination: {
        total: firms.length,
        limit: 200,
        page: 1,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Auth users lookup for HR Dashboard and system user lists
router.get('/auth/users', authenticateJWT, userController.getUsers);

// Checklist Delegation settings & helpers for HR Attendance and Leave
router.get('/checklist-delegation/settings/holidays', authenticateJWT, async (req, res, next) => {
  try {
    const { year } = req.query;
    let where: any = {};
    if (year) {
      const y = parseInt(String(year), 10);
      if (!isNaN(y)) {
        where.holiday_date = {
          gte: new Date(Date.UTC(y, 0, 1)),
          lt: new Date(Date.UTC(y + 1, 0, 1)),
        };
      }
    }
    const holidays = await prisma.holiday.findMany({
      where,
      orderBy: { holiday_date: 'asc' },
    });
    const data = holidays.map((h: any) => ({
      id: h.id.toString(),
      title: h.holiday_name,
      name: h.holiday_name,
      date: h.holiday_date ? new Date(h.holiday_date).toISOString().slice(0, 10) : '',
      isYearly: false,
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/checklist-delegation/leave-delegation/available-users', authenticateJWT, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { id: 'asc' },
    });
    const data = users.map((u: any) => ({
      id: u.id.toString(),
      name: u.full_name || u.user_name || 'User',
      employeeId: null,
      leaves: [],
    }));
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.use('/checklist-delegation', authenticateJWT, (_req, res) => {
  res.json({ success: true, data: [] });
});

// Compatibility aliases for petty cash flat endpoints
router.use('/', authenticateJWT, pettyCashRoutes);

export default router;

