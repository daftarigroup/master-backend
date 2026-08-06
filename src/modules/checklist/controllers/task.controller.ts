import { Response } from 'express';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { FirmScopedRequest, assertFirmAllowed } from '../middleware/scopeToFirmAccess.middleware';
import { calendarEngineService } from '../services/calendarEngine.service';
import { AssignTaskBody } from '../types/checklist.types';

/**
 * Unified assign-task endpoint. Routes to DelegationTask (one-time) or
 * ChecklistTask (recurring, pre-generated over a 1-year horizon) per the
 * reference doc §5 routing rule.
 */
export class TaskController {
  assignTask = asyncHandler(async (req: FirmScopedRequest, res: Response) => {
    const body = req.body as AssignTaskBody;

    assertFirmAllowed(req, String(body.firm_id));

    const startDate = new Date(body.task_start_date);
    if (isNaN(startDate.getTime())) {
      throw new ApiError(400, 'task_start_date is not a valid date');
    }

    // Resolve Assigner (Given By) Name & ID
    const givenById = body.given_by_id ? BigInt(body.given_by_id) : (req.user?.id ? BigInt(req.user.id) : null);
    let givenByName = body.given_by_name ?? null;

    if (!givenByName && givenById) {
      const givenUser = await prisma.user.findUnique({ where: { id: givenById }, select: { name: true, user_name: true } });
      givenByName = givenUser?.name || givenUser?.user_name || null;
    }

    // Resolve Doer Name
    let doerName = body.doer_name ?? null;
    if (!doerName && body.doer_id) {
      const doerUser = await prisma.user.findUnique({ where: { id: BigInt(body.doer_id) }, select: { name: true, user_name: true } });
      doerName = doerUser?.name || doerUser?.user_name || null;
    }

    // Resolve Firm Name
    let firmName = body.firm_name ?? null;
    if (!firmName && body.firm_id) {
      const firmObj = await prisma.firm.findUnique({ where: { id: BigInt(body.firm_id) }, select: { firm_name: true } });
      firmName = firmObj?.firm_name || null;
    }

    const exclusion = await calendarEngineService.loadExclusionData(body.doer_id);

    if (body.frequency === 'one-time') {
      const resolvedDate = calendarEngineService.resolveOneTimeDate(startDate, exclusion);

      const task = await prisma.delegationTask.create({
        data: {
          firm_id: BigInt(body.firm_id),
          firm_name: firmName,
          doer_id: BigInt(body.doer_id),
          doer_name: doerName,
          given_by_id: givenById,
          given_by_name: givenByName,
          task_description: body.task_description,
          require_attachment: body.require_attachment ?? false,
          duration: body.duration ?? null,
          task_start_date: resolvedDate,
          planned_date: resolvedDate,
          status: 'pending',
          instruction_attachment_url: body.instruction_attachment_url ?? null,
          instruction_attachment_type: body.instruction_attachment_type ?? null,
          remark: body.remark ?? null,
        },
      });

      return res.status(201).json({
        success: true,
        data: { type: 'delegation', task },
      });
    }

    const occurrenceDates = calendarEngineService.generateOccurrenceDates(body.frequency, startDate, exclusion);

    if (occurrenceDates.length === 0) {
      throw new ApiError(400, 'No valid occurrence dates could be generated for the given frequency/start date');
    }

    const rows = occurrenceDates.map((date) => ({
      firm_id: BigInt(body.firm_id),
      firm_name: firmName,
      doer_id: BigInt(body.doer_id),
      doer_name: doerName,
      given_by_id: givenById,
      given_by_name: givenByName,
      task_description: body.task_description,
      frequency: body.frequency,
      enable_reminder: body.enable_reminder ?? false,
      reminder_days_before: body.reminder_days_before ?? 1,
      require_attachment: body.require_attachment ?? false,
      duration: body.duration ?? null,
      planned_date: date,
      task_start_date: date,
      status: 'pending' as const,
      instruction_attachment_url: body.instruction_attachment_url ?? null,
      instruction_attachment_type: body.instruction_attachment_type ?? null,
      remark: body.remark ?? null,
    }));

    await prisma.checklistTask.createMany({ data: rows });

    return res.status(201).json({
      success: true,
      data: { type: 'checklist', count: rows.length, sample: rows.slice(0, 5) },
    });
  });
}
