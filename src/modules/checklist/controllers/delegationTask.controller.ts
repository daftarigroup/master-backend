import { Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { FirmScopedRequest, assertFirmAllowed } from '../middleware/scopeToFirmAccess.middleware';
import { TaskDelayService } from '../services/taskDelay.service';
import { DelegationSubmitBody } from '../types/checklist.types';

function buildScopeWhere(req: FirmScopedRequest): any {
  const where: any = {};

  if (req.firmScope !== null && req.firmScope !== undefined) {
    if (req.doerScope) {
      where.doer_id = BigInt(req.doerScope);
    } else {
      const ids = (req.firmScope || []).filter((f) => /^\d+$/.test(f)).map(BigInt);
      where.firm_id = { in: ids.length > 0 ? ids : [-1n] };
    }
  }

  return where;
}

export class DelegationTaskController {
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

    const data = await prisma.delegationTask.findMany({
      where,
      orderBy: { task_start_date: 'asc' },
    });

    res.json({ success: true, data });
  });

  getById = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const where = buildScopeWhere(req);

    const task = await prisma.delegationTask.findFirst({ where: { ...where, task_id: id } });
    if (!task) {
      throw new ApiError(404, 'Delegation task not found');
    }

    res.json({ success: true, data: task });
  });

  submit = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const body = req.body as DelegationSubmitBody;
    const where = buildScopeWhere(req);

    const existing = await prisma.delegationTask.findFirst({ where: { ...where, task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Delegation task not found');
    }

    let updated;

    if (body.status === 'done') {
      const submissionDate = new Date();
      const delay = TaskDelayService.calculateDelay(existing.task_start_date, submissionDate);

      updated = await prisma.delegationTask.update({
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

      await prisma.delegationDone.create({
        data: {
          task_id: id,
          status: 'done',
          reason: body.remark ?? null,
          image_url: body.image ?? null,
          audio_url: body.audio_url ?? null,
        },
      });
    } else {
      const nextExtendDate = body.next_extend_date ? new Date(body.next_extend_date) : null;
      if (!nextExtendDate || isNaN(nextExtendDate.getTime())) {
        throw new ApiError(400, 'next_extend_date is required and must be a valid date');
      }

      updated = await prisma.delegationTask.update({
        where: { task_id: id },
        data: {
          status: 'extend',
          remark: body.reason ?? undefined,
        },
      });

      await prisma.delegationDone.create({
        data: {
          task_id: id,
          status: 'extend',
          next_extend_date: nextExtendDate,
          reason: body.reason ?? null,
          image_url: body.image ?? null,
          audio_url: body.audio_url ?? null,
        },
      });
    }

    res.json({ success: true, data: updated });
  });

  approve = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));

    const existing = await prisma.delegationTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Delegation task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    const updated = await prisma.delegationTask.update({
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

  approveExtension = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));

    const existing = await prisma.delegationTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Delegation task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    const latestExtendRequest = await prisma.delegationDone.findFirst({
      where: { task_id: id, status: 'extend' },
      orderBy: { created_at: 'desc' },
    });

    if (!latestExtendRequest?.next_extend_date) {
      throw new ApiError(400, 'No pending extension request found for this task');
    }

    const updated = await prisma.delegationTask.update({
      where: { task_id: id },
      data: {
        planned_date: latestExtendRequest.next_extend_date,
        task_start_date: latestExtendRequest.next_extend_date,
        status: 'pending',
        submission_date: null,
      },
    });

    res.json({ success: true, data: updated });
  });

  reject = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));
    const { remark } = req.body as { remark?: string | null };

    const existing = await prisma.delegationTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Delegation task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    const updated = await prisma.delegationTask.update({
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

    const existing = await prisma.delegationTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Delegation task not found');
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

    const updated = await prisma.delegationTask.update({
      where: { task_id: id },
      data: {
        task_description: body.task_description !== undefined ? body.task_description : existing.task_description,
        doer_id: body.doer_id ? BigInt(body.doer_id) : existing.doer_id,
        doer_name: doerName,
        firm_id: body.firm_id ? BigInt(body.firm_id) : existing.firm_id,
        firm_name: firmName,
        given_by_id: body.given_by_id ? BigInt(body.given_by_id) : existing.given_by_id,
        given_by_name: givenByName,
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

  history = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const id = BigInt(String(req.params.id));

    const existing = await prisma.delegationTask.findUnique({ where: { task_id: id } });
    if (!existing) {
      throw new ApiError(404, 'Delegation task not found');
    }
    assertFirmAllowed(req, existing.firm_id ? String(existing.firm_id) : null);

    const history = await prisma.delegationDone.findMany({
      where: { task_id: id },
      orderBy: { created_at: 'desc' },
    });

    res.json({ success: true, data: history });
  });
}
