// Loads schedules and readings for many machines at once and runs the pure service-due rules on them.
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { currentReadings } from '../lib/currentReading';
import { toIstDateString } from '../lib/istDate';
import { loadOpsSettings } from '../lib/opsSettings';
import { ServiceDue, computeServiceDue, nearestDue } from '../lib/serviceDue';

type Db = Prisma.TransactionClient | typeof prisma;

export interface MachineDue {
  machineId: string;
  schedules: Array<{ id: string; name: string; due: ServiceDue; lastServiceAt: string | null; lastServiceReading: number | null; intervalValue: number | null; intervalDays: number | null; checklistTemplateId: string | null }>;
  /** the most urgent one (what the banner and the fleet list show), null when the machine has no schedule */
  nearest: ServiceDue | null;
  nearestScheduleId: string | null;
}

const n = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : Number(v));

export async function dueForMachines(
  db: Db,
  machines: Array<{ id: string; firmId: bigint | null; openingReading: Prisma.Decimal | number; readingUnit: 'KM' | 'HOURS' | 'NONE' }>,
  today = toIstDateString(new Date()),
): Promise<Map<string, MachineDue>> {
  const out = new Map<string, MachineDue>();
  if (machines.length === 0) return out;
  const ids = machines.map((m) => m.id);
  const [schedules, readings, settings] = await Promise.all([
    db.machineServiceSchedule.findMany({ where: { machineId: { in: ids }, isActive: true }, orderBy: { createdAt: 'asc' } }),
    currentReadings(db, machines),
    loadOpsSettings(db, machines.map((m) => m.firmId).filter((f): f is bigint => f !== null)),
  ]);

  for (const m of machines) {
    const s = m.firmId === null ? null : settings.get(String(m.firmId));
    const ctx = { readingUnit: m.readingUnit, currentReading: readings.get(m.id) ?? null, today, leadPercent: s?.serviceLeadPercent ?? 10, leadDays: s?.serviceLeadDays ?? 7 };
    const rows = schedules
      .filter((x) => x.machineId === m.id)
      .map((x) => {
        const lastServiceAt = x.lastServiceAt ? x.lastServiceAt.toISOString().slice(0, 10) : null;
        const due = computeServiceDue(
          { intervalValue: n(x.intervalValue), intervalDays: x.intervalDays, leadValue: n(x.leadValue), leadDays: x.leadDays, lastServiceAt, lastServiceReading: n(x.lastServiceReading) },
          ctx,
        );
        return { id: x.id, name: x.name, due, lastServiceAt, lastServiceReading: n(x.lastServiceReading), intervalValue: n(x.intervalValue), intervalDays: x.intervalDays, checklistTemplateId: x.checklistTemplateId };
      });
    const nearest = nearestDue(rows.map((r) => r.due));
    out.set(m.id, { machineId: m.id, schedules: rows, nearest, nearestScheduleId: rows.find((r) => r.due === nearest)?.id ?? null });
  }
  return out;
}
