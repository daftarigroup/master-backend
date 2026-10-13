// Cost by WBS activity. Cost on a tagged record goes straight to that record's activity. Untagged period costs (maintenance,
// untagged manual entries) are spread by each activity's share of the hours; rental follows the hours of the usage entries it was
// earned by. Whatever cannot be attributed (untagged fuel, untagged hours, no hours at all) lands in an "Unassigned" row, so the
// rows always add up to Total Spend exactly (paise-level largest remainder, never a rounded-then-fudged last row).
import { D, Dec, ZERO, allocate, sumDec } from './decimal';
import { CostEntryRow, UsageRow, WbsInfo } from './types';

const NONE = '\u0000none';
const key = (id: string | null) => id ?? NONE;

export interface WbsRow {
  wbsActivityId: string | null;
  code: string | null;
  name: string;
  hours: Dec;
  fuel: Dec;
  maintenance: Dec;
  rental: Dec;
  other: Dec;
  total: Dec;
  costPerUnit: Dec | null;
  /** Percent of Total Spend, one decimal; the column adds up to 100.0. */
  percentOfSpend: number | null;
}

export interface WbsInput {
  usage: UsageRow[];
  /** Priced diesel amounts with the activity each issue is tagged to. */
  fuel: Array<{ wbsActivityId: string | null; amount: Dec }>;
  maintenanceTotal: Dec;
  rentalTotal: Dec;
  otherEntries: CostEntryRow[];
  wbs: Map<string, WbsInfo>;
}

type Bucket = Map<string, Dec>;
const add = (b: Bucket, k: string, v: Dec) => b.set(k, (b.get(k) ?? ZERO).plus(v));

/** Spreads `total` over the hours buckets; with no hours everything is unassigned. */
function spread(total: Dec, hours: Bucket): Bucket {
  const out: Bucket = new Map();
  if (total.isZero()) return out;
  const keys = [...hours.keys()];
  const parts = allocate(total, keys.map((k) => hours.get(k)!));
  if (!parts) {
    out.set(NONE, total);
    return out;
  }
  keys.forEach((k, i) => {
    if (!parts[i].isZero()) out.set(k, parts[i]);
  });
  return out;
}

export function allocateWbs(input: WbsInput): { rows: WbsRow[]; totals: Omit<WbsRow, 'wbsActivityId' | 'code' | 'name'> } {
  const hours: Bucket = new Map();
  for (const u of input.usage) add(hours, key(u.wbsActivityId), u.usage);

  const fuel: Bucket = new Map();
  for (const f of input.fuel) add(fuel, key(f.wbsActivityId), f.amount);

  const rental = spread(input.rentalTotal, hours);
  const maintenance = spread(input.maintenanceTotal, hours);

  const other: Bucket = new Map();
  let untaggedOther = ZERO;
  for (const e of input.otherEntries) {
    if (e.wbsActivityId) add(other, e.wbsActivityId, e.amount);
    else untaggedOther = untaggedOther.plus(e.amount);
  }
  for (const [k, v] of spread(untaggedOther, hours)) add(other, k, v);

  const keys = new Set<string>([...hours.keys(), ...fuel.keys(), ...rental.keys(), ...maintenance.keys(), ...other.keys()]);
  const get = (b: Bucket, k: string) => b.get(k) ?? ZERO;

  const drafts = [...keys].map((k) => {
    const h = get(hours, k);
    const f = get(fuel, k);
    const m = get(maintenance, k);
    const r = get(rental, k);
    const o = get(other, k);
    return { k, h, f, m, r, o, t: f.plus(m).plus(r).plus(o) };
  });

  const grand = sumDec(drafts.map((d) => d.t));
  const pct = allocate(D(100), drafts.map((d) => d.t), 1);

  const rows: WbsRow[] = drafts.map((d, i) => {
    const info = d.k === NONE ? null : input.wbs.get(d.k);
    return {
      wbsActivityId: d.k === NONE ? null : d.k,
      code: d.k === NONE ? null : (info?.code ?? '?'),
      name: d.k === NONE ? 'Unassigned' : (info?.name ?? 'Unknown activity'),
      hours: d.h,
      fuel: d.f,
      maintenance: d.m,
      rental: d.r,
      other: d.o,
      total: d.t,
      costPerUnit: d.h.gt(0) ? d.t.div(d.h).toDecimalPlaces(2, 4) : null,
      percentOfSpend: pct ? pct[i].toNumber() : null,
    };
  });
  rows.sort((a, b) => (a.wbsActivityId === null ? 1 : 0) - (b.wbsActivityId === null ? 1 : 0) || (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true }));

  const totalHours = sumDec(rows.map((r) => r.hours));
  return {
    rows,
    totals: {
      hours: totalHours,
      fuel: sumDec(rows.map((r) => r.fuel)),
      maintenance: sumDec(rows.map((r) => r.maintenance)),
      rental: sumDec(rows.map((r) => r.rental)),
      other: sumDec(rows.map((r) => r.other)),
      total: grand,
      costPerUnit: totalHours.gt(0) ? grand.div(totalHours).toDecimalPlaces(2, 4) : null,
      percentOfSpend: grand.isZero() ? null : 100,
    },
  };
}
