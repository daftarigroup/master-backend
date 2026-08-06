import { Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { FirmScopedRequest, assertFirmAllowed } from '../middleware/scopeToFirmAccess.middleware';
import { TaskDelayService } from '../services/taskDelay.service';
import { SubmitTaskBody } from '../types/checklist.types';

function buildScopeWhere(req: FirmScopedRequest): any {
  const where: any = {};

  if (req.firmScope !== null && req.firmScope !== undefined) {
    // ADMIN or USER
    if (req.doerScope) {
      // USER: restricted to their own tasks as doer
      where.doer_id = BigInt(req.doerScope);
    } else {
      // ADMIN: restricted to their permitted firms
      const ids = (req.firmScope || []).filter((f) => /^\d+$/.test(f)).map(BigInt);
      where.firm_id = { in: ids.length > 0 ? ids : [-1n] };
    }
  }
  // SUPER_ADMIN: req.firmScope === null -> unrestricted, no filter added

  return where;
}

export class ChecklistTaskController {
  list = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const where = buildScopeWhere(req);

    if (req.query.status) {
      where.status = String(req.query.status);
    }
    if (req.query.firm_id) {
      assertFirmAllowed(req, String(req.query.firm_id));
      where.firm_id = BigInt(String(req.query.firm_id));
    }
    if (req.query.from || req.query.to) {
      where.planned_date = {};
      if (req.query.from) where.planned_date.gte = new Date(String(req.query.from));
      if (req.query.to) where.planned_date.lte = new Date(String(req.query.to));
    }

    const data = await prisma.checklistTask.findMany({
      where,
      orderBy: { planned_date: 'asc' },
    });

    res.json({ success: true, data });
  });

  getById = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const where = buildScopeWhere(req);

    const task = await prisma.checklistTask.findFirst({ where: { ...where, task_id: id } });
    if (!task) {
      throw new ApiError(404, 'Checklist task not found');
    }

    res.json({ success: true, data: task });
  });

  submit = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body as SubmitTaskBody;
    const where = buildScopeWhere(req);

    const existing = await prisma.checklistTask.findFirst({ where: { ...where, task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Checklist task not found');
    }

    const submissionDate = new Date();
    const delay = TaskDelayService.calculateDelay(existing.task_start_date, submissionDate);

    const updated = await prisma.checklistTask.update({
      where: { task_id: id },
      data: {
        image: body.image ?? undefined,
        audio_url: body.audio_url ?? undefined,
        remark: body.remark ?? undefined,
        submission_date: submissionDate,
        status: 'done',
        delay,
      },
    });

    res.json({ success: true, data: updated });
  });

  approve = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));

    const existing = await prisma.checklistTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Checklist task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    const updated = await prisma.checklistTask.update({
      where: { task_id: id },
      data: {
        admin_done: true,
        admin_approved_by: req.user?.id ? BigInt(req.user.id) : null,
        admin_approval_date: new Date(),
        status: 'approved',
      },
    });

    res.json({ success: true, data: updated });
  });

  reject = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { remark } = req.body as { remark?: string | null };

    const existing = await prisma.checklistTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Checklist task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    const updated = await prisma.checklistTask.update({
      where: { task_id: id },
      data: {
        status: 'rejected',
        admin_done: false,
        remark: remark ?? existing.remark,
      },
    });

    res.json({ success: true, data: updated });
  });

  update = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    const existing = await prisma.checklistTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Checklist task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    let doerName = body.doer_name ?? existing.doer_name;
    if (body.doer_id && body.doer_id !== String(existing.doer_id)) {
      const doerUser = await prisma.user.findUnique({ where: { id: BigInt(body.doer_id) }, select: { name: true, user_name: true } });
      doerName = doerUser?.name || doerUser?.user_name || doerName;
    }

    let firmName = body.firm_name ?? existing.firm_name;
    if (body.firm_id && body.firm_id !== String(existing.firm_id)) {
      const firmObj = await prisma.firm.findUnique({ where: { id: BigInt(body.firm_id) }, select: { firm_name: true } });
      firmName = firmObj?.firm_name || firmName;
    }

    let givenByName = body.given_by_name ?? existing.given_by_name;
    if (body.given_by_id && body.given_by_id !== String(existing.given_by_id)) {
      const givenUser = await prisma.user.findUnique({ where: { id: BigInt(body.given_by_id) }, select: { name: true, user_name: true } });
      givenByName = givenUser?.name || givenUser?.user_name || givenByName;
    }

    const updated = await prisma.checklistTask.update({
      where: { task_id: id },
      data: {
        task_description: body.task_description !== undefined ? body.task_description : existing.task_description,
        doer_id: body.doer_id ? BigInt(body.doer_id) : existing.doer_id,
        doer_name: doerName,
        firm_id: body.firm_id ? BigInt(body.firm_id) : existing.firm_id,
        firm_name: firmName,
        given_by_id: body.given_by_id ? BigInt(body.given_by_id) : existing.given_by_id,
        given_by_name: givenByName,
        frequency: body.frequency !== undefined ? body.frequency : existing.frequency,
        duration: body.duration !== undefined ? body.duration : existing.duration,
        require_attachment: body.require_attachment !== undefined ? Boolean(body.require_attachment) : existing.require_attachment,
        remark: body.remark !== undefined ? body.remark : existing.remark,
        instruction_attachment_url: body.instruction_attachment_url !== undefined ? body.instruction_attachment_url : existing.instruction_attachment_url,
        instruction_attachment_type: body.instruction_attachment_type !== undefined ? body.instruction_attachment_type : existing.instruction_attachment_type,
        audio_url: body.audio_url !== undefined ? body.audio_url : existing.audio_url,
      },
    });

    res.json({ success: true, data: updated });
  });

  /**
   * Bulk-update all checklist tasks in the same recurrence group.
   *
   * A "recurrence group" is defined by the fingerprint of the anchor task:
   *   (doer_id, firm_id, task_description, frequency)
   *
   * Only non-schedule fields are updated (task_description, doer, firm, duration,
   * require_attachment, remark, instruction_attachment_url, audio_url).
   * planned_date and task_start_date are intentionally left untouched to
   * preserve calendar occurrence tracking.
   */
  updateGroup = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body;

    // Load the anchor task to derive the fingerprint
    const anchor = await prisma.checklistTask.findUnique({ where: { task_id: id } });
    if (!anchor) {
      throw new ApiError(404, 'Checklist task not found');
    }
    assertFirmAllowed(req, anchor.firm_id ? String(anchor.firm_id) : null);

    // Resolve new doer/firm/given_by names if IDs are changing
    let newDoerId = anchor.doer_id;
    let newDoerName = anchor.doer_name;
    if (body.doer_id) {
      newDoerId = BigInt(body.doer_id);
      if (body.doer_id !== String(anchor.doer_id)) {
        const doerUser = await prisma.user.findUnique({
          where: { id: newDoerId! },
          select: { name: true, user_name: true },
        });
        newDoerName = doerUser?.name || doerUser?.user_name || anchor.doer_name;
      } else {
        newDoerName = body.doer_name ?? anchor.doer_name;
      }
    }

    let newFirmId = anchor.firm_id;
    let newFirmName = anchor.firm_name;
    if (body.firm_id) {
      newFirmId = BigInt(body.firm_id);
      if (body.firm_id !== String(anchor.firm_id)) {
        const firmObj = await prisma.firm.findUnique({
          where: { id: newFirmId! },
          select: { firm_name: true },
        });
        newFirmName = firmObj?.firm_name || anchor.firm_name;
      } else {
        newFirmName = body.firm_name ?? anchor.firm_name;
      }
    }

    // Build the fingerprint WHERE clause using the ORIGINAL anchor values
    // so we correctly find all siblings in the same recurrence group
    const fingerprintWhere: any = {
      firm_id: anchor.firm_id,
      doer_id: anchor.doer_id,
      task_description: anchor.task_description,
      frequency: anchor.frequency,
    };

    // Scope to permitted firms only
    const scopeWhere: any = {};
    if (req.firmScope !== null && req.firmScope !== undefined) {
      if (req.doerScope) {
        scopeWhere.doer_id = BigInt(req.doerScope);
      } else {
        const ids = (req.firmScope || []).filter((f) => /^\d+$/.test(f)).map(BigInt);
        scopeWhere.firm_id = { in: ids.length > 0 ? ids : [-1n] };
      }
    }

    const groupWhere = { ...fingerprintWhere, ...scopeWhere };

    // Count tasks before updating so we can report back
    const count = await prisma.checklistTask.count({ where: groupWhere });

    // Bulk update all tasks in the group — intentionally NOT updating planned_date / task_start_date
    await prisma.checklistTask.updateMany({
      where: groupWhere,
      data: {
        task_description: body.task_description !== undefined ? body.task_description : anchor.task_description,
        doer_id: newDoerId,
        doer_name: newDoerName,
        firm_id: newFirmId,
        firm_name: newFirmName,
        frequency: body.frequency !== undefined ? body.frequency : anchor.frequency,
        duration: body.duration !== undefined ? body.duration : anchor.duration,
        require_attachment: body.require_attachment !== undefined ? Boolean(body.require_attachment) : anchor.require_attachment,
        remark: body.remark !== undefined ? body.remark : anchor.remark,
        instruction_attachment_url: body.instruction_attachment_url !== undefined ? body.instruction_attachment_url : anchor.instruction_attachment_url,
        instruction_attachment_type: body.instruction_attachment_type !== undefined ? body.instruction_attachment_type : anchor.instruction_attachment_type,
        audio_url: body.audio_url !== undefined ? body.audio_url : anchor.audio_url,
      },
    });

    res.json({ success: true, updatedCount: count, anchorTaskId: Number(anchor.task_id) });
  });
}
