import { dateToISO, dateToISODate, decimalToNumberOrNull, userDTO } from './mapUtils';
import { priorityToNumber } from './priority';

function activityTypeDTO(a: any) {
  if (!a) return null;
  return { id: a.id, tenantId: a.firmId ? String(a.firmId) : '1', name: a.name, code: a.code, isSystem: a.isSystem };
}

export const planMapper = {
  toDTO(row: any) {
    return {
      id: row.id,
      planCode: row.planCode ?? undefined,
      tenantId: row.firmId ? String(row.firmId) : '1',
      machineId: row.machineId,
      title: row.title,
      description: row.description,
      activityType: activityTypeDTO(row.activityType),
      machinePart: row.machinePart ? { id: row.machinePart.id, name: row.machinePart.name, partNumber: row.machinePart.partNumber } : null,
      documentUrl: row.documentUrl,
      documentMediaId: null,
      frequency: row.frequency,
      status: row.status,
      priority: priorityToNumber(row.priority),
      estimatedMinutes: row.estimatedMinutes ?? 0,
      onHoliday: row.onHoliday,
      startDate: dateToISODate(row.startDate),
      endDate: dateToISODate(row.endDate),
      triggerAfterHours: decimalToNumberOrNull(row.triggerAfterHours),
      toleranceHours: decimalToNumberOrNull(row.toleranceHours),
      triggerAfterUnits: decimalToNumberOrNull(row.triggerAfterUnits),
      toleranceUnits: decimalToNumberOrNull(row.toleranceUnits),
      assignedToId: row.assignedToUserId ? String(row.assignedToUserId) : '',
      createdById: row.createdById ? String(row.createdById) : '',
      createdAt: dateToISO(row.createdAt),
      updatedAt: dateToISO(row.updatedAt),
      machine: row.machine ? { id: row.machine.id, name: row.machine.name, assetCode: row.machine.assetCode, status: row.machine.status } : null,
      assignedTo: userDTO(row.assignedTo),
      workOrders: row.workOrders
        ? row.workOrders.map((w: any) => ({
            id: w.id,
            status: w.status,
            actualDueDate: dateToISO(w.actualDueDate),
            currentAssignee: userDTO(w.currentAssignee),
          }))
        : undefined,
      _count: row._count ? { workOrders: row._count.workOrders } : undefined,
    };
  },

  toPrismaCreate(body: Record<string, any>) {
    return {
      title: body.title,
      planCode: body.planCode ?? null,
      description: body.description ?? null,
      documentUrl: body.documentUrl ?? null,
      frequency: body.frequency,
      status: 'ACTIVE' as const,
      estimatedMinutes: body.estimatedMinutes ?? null,
      onHoliday: body.onHoliday ?? 'SHIFT_NEXT',
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
      triggerAfterHours: body.triggerAfterHours ?? null,
      toleranceHours: body.toleranceHours ?? null,
      triggerAfterUnits: body.triggerAfterUnits ?? null,
      toleranceUnits: body.toleranceUnits ?? null,
    };
  },

  toPrismaUpdate(body: Record<string, any>) {
    const data: Record<string, any> = {};
    const set = (key: string, value: any) => {
      if (value !== undefined) data[key] = value;
    };
    set('title', body.title);
    set('description', body.description);
    set('documentUrl', body.documentUrl);
    if (body.startDate !== undefined) set('startDate', new Date(body.startDate));
    if (body.endDate !== undefined) set('endDate', body.endDate ? new Date(body.endDate) : null);
    set('estimatedMinutes', body.estimatedMinutes);
    set('onHoliday', body.onHoliday);
    return data;
  },
};
