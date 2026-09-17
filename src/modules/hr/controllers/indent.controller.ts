import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';

export interface HrIndentRecord {
  id: string;
  recordId: string;
  title: string;
  gender: 'MALE' | 'FEMALE' | 'ANY';
  departmentId: string;
  department?: { id: string; name: string } | null;
  prefer: 'FRESHER' | 'EXPERIENCE' | 'ANY';
  experienceYears?: string;
  noOfPost: number;
  completionDate: string;
  socialsite: string[];
  jobType?: string[];
  budget?: number | null;
  priority?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  candidates?: { id: number }[];
  _count?: { candidates: number };
}

const DATA_FILE = path.join(__dirname, '../data/hr_indents.json');

export function loadIndents(): HrIndentRecord[] {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf-8');
      return [];
    }
    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error('Failed to load indents from disk:', err);
    return [];
  }
}

function saveIndents(data: HrIndentRecord[]): void {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save indents to disk:', err);
  }
}

export class IndentController {
  private indents: HrIndentRecord[] = loadIndents();

  /**
   * GET /api/hrfms/indent
   */
  getAll = asyncHandler(async (_req: Request, res: Response) => {
    // Refresh from disk in case of external changes
    this.indents = loadIndents();
    res.json({
      success: true,
      data: this.indents,
    });
  });

  /**
   * GET /api/hrfms/indent/get-pending
   */
  getPending = asyncHandler(async (_req: Request, res: Response) => {
    this.indents = loadIndents();
    const pending = this.indents.filter(
      (i) => i.status === 'open' || (i._count?.candidates ?? 0) < i.noOfPost
    );
    res.json({
      success: true,
      data: pending,
    });
  });

  /**
   * GET /api/hrfms/indent/:id
   */
  getOne = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    this.indents = loadIndents();
    const indent = this.indents.find((i) => String(i.id) === String(id));
    if (!indent) {
      res.status(404).json({ success: false, message: 'Indent not found' });
      return;
    }
    res.json({
      success: true,
      data: indent,
    });
  });

  /**
   * POST /api/hrfms/indent
   */
  create = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body || {};
    this.indents = loadIndents();

    // Resolve department details from DB if departmentId is provided
    let departmentObj: { id: string; name: string } | null = null;
    const departmentIdStr = String(body.departmentId || body.department || '');

    if (departmentIdStr) {
      try {
        const parsedDeptId = BigInt(departmentIdStr);
        const dept = await prisma.department.findUnique({
          where: { id: parsedDeptId },
        });
        if (dept) {
          departmentObj = {
            id: dept.id.toString(),
            name: dept.name,
          };
        }
      } catch (_e) {
        // In case departmentId is non-numeric string or lookup fails
        departmentObj = {
          id: departmentIdStr,
          name: typeof body.department === 'string' ? body.department : 'General',
        };
      }
    }

    const nextNumericId = this.indents.reduce((max, i) => {
      const n = parseInt(i.id, 10);
      return !isNaN(n) && n > max ? n : max;
    }, 0) + 1;

    const recordId = `REC-${String(nextNumericId).padStart(2, '0')}`;
    const nowIso = new Date().toISOString();

    const newIndent: HrIndentRecord = {
      id: String(nextNumericId),
      recordId,
      title: body.title || 'Untitled Position',
      gender: body.gender || 'ANY',
      departmentId: departmentIdStr,
      department: departmentObj,
      prefer: body.prefer || 'ANY',
      experienceYears: body.experienceYears || '',
      noOfPost: Number(body.noOfPost) || 1,
      completionDate: body.completionDate || new Date(Date.now() + 30 * 86400000).toISOString(),
      socialsite: Array.isArray(body.socialsite) ? body.socialsite : [],
      jobType: Array.isArray(body.jobType) ? body.jobType : ['Onsite'],
      budget: body.budget != null ? Number(body.budget) : null,
      priority: body.priority || 'normal',
      status: body.status || 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
      candidates: [],
      _count: { candidates: 0 },
    };

    this.indents.unshift(newIndent);
    saveIndents(this.indents);

    res.status(201).json({
      success: true,
      data: newIndent,
      message: 'Indent created successfully',
    });
  });

  /**
   * PATCH /api/hrfms/indent/:id
   */
  update = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    this.indents = loadIndents();
    const indent = this.indents.find((i) => String(i.id) === String(id));
    if (!indent) {
      res.status(404).json({ success: false, message: 'Indent not found' });
      return;
    }

    const body = req.body || {};
    if (body.status !== undefined) indent.status = body.status;
    if (body.priority !== undefined) indent.priority = body.priority;
    if (body.title !== undefined) indent.title = body.title;
    if (body.noOfPost !== undefined) indent.noOfPost = Number(body.noOfPost);
    if (body.budget !== undefined) indent.budget = body.budget != null ? Number(body.budget) : null;
    if (body.socialsite !== undefined) indent.socialsite = body.socialsite;
    if (body.jobType !== undefined) indent.jobType = body.jobType;
    if (body.completionDate !== undefined) indent.completionDate = body.completionDate;

    indent.updatedAt = new Date().toISOString();
    saveIndents(this.indents);

    res.json({
      success: true,
      data: indent,
      message: 'Indent updated successfully',
    });
  });

  /**
   * DELETE /api/hrfms/indent/:id
   */
  delete = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id;
    this.indents = loadIndents();
    const idx = this.indents.findIndex((i) => String(i.id) === String(id));
    if (idx !== -1) {
      this.indents.splice(idx, 1);
      saveIndents(this.indents);
    }
    res.json({
      success: true,
      message: 'Indent deleted successfully',
    });
  });
}
