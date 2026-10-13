// Document expiry rules. Pure functions, `today` is injected ('YYYY-MM-DD' in IST, see istDate.ts) so tests are deterministic.
// Status is DERIVED from validTill and today; it is never stored or typed. This is the only definition: the Equipment Documents
// tabs, banners, the fleet register, tiles, sidebar badge, dashboard alert and the Equipment Master chip all call it.

export type DocStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';

export const DEFAULT_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(utc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / DAY_MS);
}

export interface StatusResult {
  status: DocStatus;
  /** Days until expiry (0 = expires today); negative once expired; null without a validity date. */
  daysLeft: number | null;
  /** Secondary text: "Expires today", "21 days left", "Expired 50 days ago". */
  label: string;
}

/**
 * EXPIRED if validTill < today; EXPIRING_SOON if today <= validTill <= today + window (expires today counts);
 * VALID if later; NO_EXPIRY without a validity date. A document is valid through the end of validTill.
 */
export function documentStatus(doc: { validTill: string | null }, today: string, windowDays: number = DEFAULT_WINDOW_DAYS): StatusResult {
  if (!doc.validTill) return { status: 'NO_EXPIRY', daysLeft: null, label: 'No expiry' };
  const left = daysBetween(today, doc.validTill);
  if (left < 0) return { status: 'EXPIRED', daysLeft: left, label: left === -1 ? 'Expired 1 day ago' : `Expired ${-left} days ago` };
  if (left <= windowDays) return { status: 'EXPIRING_SOON', daysLeft: left, label: left === 0 ? 'Expires today' : left === 1 ? '1 day left' : `${left} days left` };
  return { status: 'VALID', daysLeft: left, label: `${left} days left` };
}

/** Severity for sorting and "worst status": lower is more urgent. */
export const STATUS_RANK: Record<DocStatus, number> = { EXPIRED: 0, EXPIRING_SOON: 1, VALID: 2, NO_EXPIRY: 3 };

export interface CurrentCandidate {
  id: string;
  /** (machine or operator) + type; documents of different owners or types never compete. */
  groupKey: string;
  singleCurrent: boolean;
  validTill: string | null;
  issuedAt: string | null;
  createdAt: string;
}

/**
 * Current vs history. For a singleCurrent type the current document per group is the one with the greatest validTill (a missing
 * validTill sorts lowest; ties: latest issued, then latest uploaded); the others are history and are ignored by tabs, banners,
 * tiles, badges and alerts, so a renewed insurance never leaves the old one in "Expired". Other types keep every document current.
 * Input must already exclude voided documents: voiding the new one makes the old one current again on the next call.
 */
export function splitCurrent<T extends CurrentCandidate>(docs: T[]): { current: T[]; history: T[] } {
  const best = new Map<string, T>();
  for (const d of docs) {
    if (!d.singleCurrent) continue;
    const b = best.get(d.groupKey);
    if (!b || beats(d, b)) best.set(d.groupKey, d);
  }
  const current: T[] = [];
  const history: T[] = [];
  for (const d of docs) (!d.singleCurrent || best.get(d.groupKey)?.id === d.id ? current : history).push(d);
  return { current, history };
}

function beats(a: CurrentCandidate, b: CurrentCandidate): boolean {
  const av = a.validTill ?? '';
  const bv = b.validTill ?? '';
  if (av !== bv) return av > bv;
  const ai = a.issuedAt ?? '';
  const bi = b.issuedAt ?? '';
  if (ai !== bi) return ai > bi;
  return a.createdAt > b.createdAt;
}

/** The "Latest" badge: the newest current document per group of a no-validity Service type. Returns the ids to badge. */
export function latestIds<T extends { id: string; groupKey: string; validTill: string | null; issuedAt: string | null; createdAt: string }>(docs: T[]): Set<string> {
  const best = new Map<string, T>();
  for (const d of docs) {
    if (d.validTill) continue;
    const b = best.get(d.groupKey);
    const dk = `${d.issuedAt ?? ''}|${d.createdAt}`;
    if (!b || dk > `${b.issuedAt ?? ''}|${b.createdAt}`) best.set(d.groupKey, d);
  }
  return new Set([...best.values()].map((d) => d.id));
}

/** "Insurance, PUC, Fitness Certificate" or "Insurance, PUC, Fitness Certificate +2 more": first 3 names, de-duplicated, then a count. */
export function bannerNames(names: string[], max = 3): string {
  const unique = [...new Set(names)];
  if (unique.length <= max) return unique.join(', ');
  return `${unique.slice(0, max).join(', ')} +${unique.length - max} more`;
}

/** Warning chip: a hired machine's agreement ends before the hire does. Neither value is edited automatically. */
export function agreementEndsBeforeHire(agreementValidTill: string | null, rentalEndDate: string | null): boolean {
  return Boolean(agreementValidTill && rentalEndDate && rentalEndDate > agreementValidTill);
}

/** Name used for a download: {TYPECODE}-{ASSETCODE}[-n].{ext}, sanitised to a header-safe token. */
export function downloadName(typeCode: string, assetCode: string, index: number, originalName: string): string {
  const ext = (/\.([A-Za-z0-9]{1,5})$/.exec(originalName)?.[1] ?? 'bin').toLowerCase();
  const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${clean(typeCode)}-${clean(assetCode)}${index > 0 ? `-${index + 1}` : ''}.${ext}`;
}
