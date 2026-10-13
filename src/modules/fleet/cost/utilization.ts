// Utilization and derived status: the ONE implementation, used by the equipment list (per machine, in bulk) and the cost screens.
import { D, Dec, sumDec } from './decimal';
import { Iso, Period, countWorkingDays, maxIso, minIso } from './period';
import { MachineFacts, SettingsFacts, UsageRow } from './types';

export interface Utilization {
  /** Whole-number percentage, capped at 100. Null when it cannot be measured (NONE unit, or no available time). */
  percent: number | null;
  /** The uncapped value exceeded 100 (ran more than the shift): shown as an "over-shift" flag. */
  overShift: boolean;
  availableHours: Dec | null;
  workingDays: number;
}

/**
 * HOURS machines: run hours / available hours, where available = shift hours per day x working days from
 * max(period start, hire start or commissioning) to min(period end, release date, today).
 * KM machines: days with at least one complete entry / working days. NONE machines have no utilization.
 */
export function computeUtilization(machine: MachineFacts, settings: SettingsFacts, period: Period, today: Iso, usage: UsageRow[]): Utilization {
  const none: Utilization = { percent: null, overShift: false, availableHours: null, workingDays: 0 };
  if (machine.readingUnit === 'NONE') return none;

  const availableFrom = maxIso(period.from, machine.rentalStartDate ?? machine.commissionedOn ?? period.from);
  const availableTo = minIso(minIso(period.to, today), machine.rentalEndDate ?? period.to);
  const workingDays = countWorkingDays(availableFrom, availableTo, settings.workingDays);
  if (workingDays === 0) return { ...none, workingDays };

  const rows = usage.filter((u) => u.logDate >= period.from && u.logDate <= period.to);
  const shift = machine.shiftHoursPerDay ?? settings.standardHoursPerDay;
  const availableHours = shift.mul(workingDays);

  let raw: Dec;
  if (machine.readingUnit === 'HOURS') {
    raw = sumDec(rows.map((r) => r.usage)).div(availableHours).mul(100);
  } else {
    raw = D(new Set(rows.map((r) => r.logDate)).size).div(workingDays).mul(100);
  }
  const rounded = raw.toDecimalPlaces(0, 4 /* ROUND_HALF_UP */).toNumber();
  return { percent: Math.min(rounded, 100), overShift: raw.gt(100), availableHours, workingDays };
}

export type DerivedStatus = 'UNDER_MAINT' | 'IN_TRANSIT' | 'AVAILABLE' | 'IN_USE' | 'IDLE';

export interface StatusInput {
  machineStatus: 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'BREAKDOWN' | 'IDLE' | 'DECOMMISSIONED';
  assetStatus: 'ACTIVE' | 'INACTIVE' | 'UNDER_REPAIR' | 'DISPOSED' | null;
  /** An open breakdown or repair work order exists. */
  hasOpenBreakdownOrRepair: boolean;
  /** Latest complete usage entry date or diesel issue date, or null when there is none. */
  lastActivityDate: Iso | null;
  today: Iso;
  idleAfterDays: number;
  /** The machine has an ACTIVE project assignment. Left out = assumed true (callers that predate assignments). */
  hasActiveAssignment?: boolean;
  /** A transfer of this machine has been dispatched and not yet received. */
  inTransit?: boolean;
}

/**
 * Mutually exclusive, in this order: Under Maint. if the machine is UNDER_MAINTENANCE/BREAKDOWN, the asset is UNDER_REPAIR, or an
 * open breakdown/repair work order exists; In Transit when a transfer is dispatched; Available when it has no active assignment;
 * otherwise In Use when there was a complete usage entry or a diesel issue within `idleAfterDays`, else Idle. Every machine lands in
 * exactly one status, so the tiles always add up to the total.
 */
export function deriveStatus(i: StatusInput): DerivedStatus {
  if (i.machineStatus === 'UNDER_MAINTENANCE' || i.machineStatus === 'BREAKDOWN' || i.assetStatus === 'UNDER_REPAIR' || i.hasOpenBreakdownOrRepair) {
    return 'UNDER_MAINT';
  }
  if (i.inTransit) return 'IN_TRANSIT';
  if (i.hasActiveAssignment === false) return 'AVAILABLE';
  if (i.lastActivityDate) {
    const cutoff = new Date(Date.UTC(Number(i.today.slice(0, 4)), Number(i.today.slice(5, 7)) - 1, Number(i.today.slice(8, 10))) - i.idleAfterDays * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (i.lastActivityDate >= cutoff) return 'IN_USE';
  }
  return 'IDLE';
}

/** Disposed, inactive, decommissioned and released machines are left out of the tiles and the list unless a filter asks for them. */
export function isInFleet(machine: Pick<MachineFacts, 'rentalEndDate'>, machineStatus: StatusInput['machineStatus'], assetStatus: StatusInput['assetStatus'], today: Iso): boolean {
  if (machineStatus === 'DECOMMISSIONED') return false;
  if (assetStatus === 'DISPOSED' || assetStatus === 'INACTIVE') return false;
  if (machine.rentalEndDate && machine.rentalEndDate < today) return false;
  return true;
}
