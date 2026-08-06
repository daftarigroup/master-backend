/**
 * Computes a human-readable delay string from a planned/start date to the
 * actual submission date. Mirrors the intent of the reference doc's
 * `update_delay_hhmmss` Postgres trigger (submission_date - task_start_date),
 * done in application code per this project's convention (see
 * store/services/delayCalculator.service.ts).
 */
export class TaskDelayService {
  static calculateDelay(
    start: Date | string | null | undefined,
    submission: Date | string | null | undefined
  ): string | null {
    if (!start || !submission) return null;

    const startDate = new Date(start);
    const submissionDate = new Date(submission);

    if (isNaN(startDate.getTime()) || isNaN(submissionDate.getTime())) return null;

    let diffMs = submissionDate.getTime() - startDate.getTime();
    const isEarly = diffMs < 0;
    diffMs = Math.abs(diffMs);

    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    const label = parts.join(' ');
    return isEarly ? `-${label}` : label;
  }
}
