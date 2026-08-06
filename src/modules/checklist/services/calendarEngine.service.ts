import { prisma } from '../../../database/prisma';
import { Frequency } from '../types/checklist.types';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const NTH_WEEK_MAP: Record<string, number> = {
  'end-of-1st-week': 1,
  'end-of-2nd-week': 2,
  'end-of-3rd-week': 3,
  'end-of-4rth-week': 4,
};

export interface ExclusionData {
  holidaysSet: Set<string>;
  workingDaysSet: Set<string>;
  dayOff: string | null;
}

function getLocalDateString(date: Date | string): string {
  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLocalDayName(date: Date): string {
  return DAY_NAMES[date.getDay()];
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

/**
 * Ports the Dynamic Calendar Engine described in
 * checklist_delegation_architecture.md §6.1 / §6.2, reading Holiday /
 * WorkingDayCalendar / User.day_off from Prisma instead of Supabase.
 */
export class CalendarEngineService {
  /**
   * Loads all exclusion inputs for a given doer once, so a single call's
   * worth of recurrence generation only hits the DB three times regardless
   * of how many candidate dates end up being evaluated.
   */
  async loadExclusionData(doerId: number | bigint | string): Promise<ExclusionData> {
    const [holidays, workingDays, doer] = await Promise.all([
      prisma.holiday.findMany({ select: { holiday_date: true } }),
      prisma.workingDayCalendar.findMany({ select: { working_date: true } }),
      prisma.user.findUnique({ where: { id: BigInt(doerId) }, select: { day_off: true } }),
    ]);

    return {
      holidaysSet: new Set(holidays.map((h) => getLocalDateString(h.holiday_date))),
      workingDaysSet: new Set(workingDays.map((w) => getLocalDateString(w.working_date))),
      dayOff: doer?.day_off ? doer.day_off.trim() : null,
    };
  }

  /**
   * §6.1 IsExcluded(D, U) = IsHoliday(D) OR NOT IsWorkingDay(D) OR IsDayOff(D, U)
   */
  isExcludedDay(date: Date, exclusion: ExclusionData): boolean {
    const dateStr = getLocalDateString(date);
    const dayName = DAY_NAMES[date.getDay()];

    const isHoliday = exclusion.holidaysSet.has(dateStr);
    const isWorkingDay = exclusion.workingDaysSet.has(dateStr);
    const isDayOff = exclusion.dayOff ? dayName === exclusion.dayOff.toLowerCase().trim() : false;

    return isHoliday || !isWorkingDay || isDayOff;
  }

  /**
   * §6.2.1 One-Time: shift forward day-by-day (up to 30 days) until a valid
   * working date is found.
   */
  resolveOneTimeDate(startDate: Date, exclusion: ExclusionData): Date {
    let candidate = new Date(startDate);
    for (let i = 0; i < 30; i++) {
      if (!this.isExcludedDay(candidate, exclusion)) {
        return candidate;
      }
      candidate = addDays(candidate, 1);
    }
    return candidate;
  }

  /**
   * §6.2.2-4: generates the 1-year horizon of occurrence dates for any
   * recurring frequency, exclusion-filtered.
   */
  generateOccurrenceDates(frequency: Frequency, startDate: Date, exclusion: ExclusionData): Date[] {
    const horizonEnd = addMonths(startDate, 12);

    if (frequency === 'daily' || frequency === 'alternate-day') {
      return this.generateDailyOrAlternate(frequency, startDate, horizonEnd, exclusion);
    }

    if (
      frequency === 'weekly' ||
      frequency === 'fortnight' ||
      frequency === 'monthly' ||
      frequency === 'quarterly' ||
      frequency === 'half-yearly' ||
      frequency === 'yearly'
    ) {
      return this.generateIntervalDates(frequency, startDate, horizonEnd, exclusion);
    }

    if (frequency in NTH_WEEK_MAP) {
      return this.generateNthWeekdayDates(frequency, startDate, horizonEnd, exclusion);
    }

    return [];
  }

  private generateDailyOrAlternate(
    frequency: 'daily' | 'alternate-day',
    startDate: Date,
    horizonEnd: Date,
    exclusion: ExclusionData
  ): Date[] {
    const validDays: Date[] = [];
    let cursor = new Date(startDate);
    while (cursor <= horizonEnd) {
      if (!this.isExcludedDay(cursor, exclusion)) {
        validDays.push(new Date(cursor));
      }
      cursor = addDays(cursor, 1);
    }
    if (frequency === 'daily') return validDays;
    return validDays.filter((_, idx) => idx % 2 === 0);
  }

  private generateIntervalDates(
    frequency: 'weekly' | 'fortnight' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly',
    startDate: Date,
    horizonEnd: Date,
    exclusion: ExclusionData
  ): Date[] {
    const dates: Date[] = [];
    let anchor = new Date(startDate);

    while (anchor <= horizonEnd) {
      let candidate = new Date(anchor);
      let guard = 0;
      // shift forward step-by-step until reaching a valid working day
      while (this.isExcludedDay(candidate, exclusion) && guard < 60) {
        candidate = addDays(candidate, 1);
        guard++;
      }
      if (candidate <= horizonEnd) {
        dates.push(candidate);
      }
      anchor = this.stepAnchor(anchor, frequency);
    }

    return dates;
  }

  private stepAnchor(
    date: Date,
    frequency: 'weekly' | 'fortnight' | 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'
  ): Date {
    switch (frequency) {
      case 'weekly':
        return addDays(date, 7);
      case 'fortnight':
        return addDays(date, 14);
      case 'monthly':
        return addMonths(date, 1);
      case 'quarterly':
        return addMonths(date, 3);
      case 'half-yearly':
        return addMonths(date, 6);
      case 'yearly':
        return addMonths(date, 12);
    }
  }

  private generateNthWeekdayDates(
    frequency: string,
    startDate: Date,
    horizonEnd: Date,
    exclusion: ExclusionData
  ): Date[] {
    const n = NTH_WEEK_MAP[frequency];
    const anchorWeekday = startDate.getDay();
    const dates: Date[] = [];

    let monthCursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1, startDate.getHours(), startDate.getMinutes());

    while (monthCursor <= horizonEnd) {
      const nthDate = this.getNthWeekdayOfMonth(
        monthCursor.getFullYear(),
        monthCursor.getMonth(),
        anchorWeekday,
        n,
        startDate
      );

      if (nthDate && nthDate >= startDate && nthDate <= horizonEnd) {
        let candidate = new Date(nthDate);
        let guard = 0;
        while (this.isExcludedDay(candidate, exclusion) && guard < 60) {
          candidate = addDays(candidate, 1);
          guard++;
        }
        if (candidate <= horizonEnd) {
          dates.push(candidate);
        }
      }

      monthCursor = addMonths(monthCursor, 1);
    }

    return dates;
  }

  private getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number, timeSource: Date): Date | null {
    const first = new Date(year, month, 1);
    const firstWeekday = first.getDay();
    const dayOfMonth = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
    const candidate = new Date(year, month, dayOfMonth, timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds());
    if (candidate.getMonth() !== month) return null; // nth occurrence doesn't exist this month
    return candidate;
  }
}

export const calendarEngineService = new CalendarEngineService();
