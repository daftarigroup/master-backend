// Parts a repair work order needs, and how much of each has been issued from the Store. Issued quantity is never stored: it is the
// sum of the live (not voided) work_order_part_issues rows, which exist only for approved Store issues.
const EPS = 0.0005;
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const isDecided = (status: unknown): boolean => {
  const s = String(status ?? '').trim().toLowerCase();
  return s === 'approved' || s === 'completed' || s === 'rejected';
};

export interface PartRow {
  id: string;
  itemId: bigint | null;
  itemName: string;
  groupHead: string;
  uom: string | null;
  quantity: unknown;
  note: string | null;
  indentNumber: string | null;
  status: string;
  issues?: Array<{ quantity: unknown; amount: unknown; voidedAt?: Date | null }>;
  storeIssues?: Array<{ id: bigint | number; quantity: unknown; status?: string | null }>;
  indents?: Array<{ id: bigint | number; indent_number?: string | null; approved_vendor_name?: string | null; vendor_name1?: string | null }>;
}

export interface PartLine {
  id: string;
  itemId: string | null;
  itemName: string;
  groupHead: string;
  uom: string | null;
  quantity: number;
  issued: number;
  remaining: number;
  pending: number;
  open: number;
  complete: boolean;
  note: string | null;
  indentNumber: string | null;
  issuedAmount: number | null; // cost data: stripped for users without cost access
  vendorName?: string | null;
}

export interface PartsSummary {
  lines: PartLine[];
  total: number; // number of lines
  complete: number; // lines fully issued
  waiting: boolean; // some line is not fully issued (or no line is listed at all)
  suggestedVendor?: string | null;
}

export function summarizeParts(rows: PartRow[] | null | undefined): PartsSummary {
  const lines: PartLine[] = (rows ?? [])
    .filter((r) => r.status === 'OPEN')
    .map((r) => {
      const live = (r.issues ?? []).filter((i) => !i.voidedAt);
      const quantity = num(r.quantity);
      const issued = Math.round(live.reduce((s, i) => s + num(i.quantity), 0) * 1000) / 1000;
      const remaining = Math.max(0, Math.round((quantity - issued) * 1000) / 1000);
      const pending = Math.round(
        (r.storeIssues ?? [])
          .filter((si) => !isDecided(si.status))
          .reduce((s, si) => s + num(si.quantity), 0) * 1000
      ) / 1000;
      const open = Math.max(0, Math.round((quantity - issued - pending) * 1000) / 1000);
      const amounts = live.filter((i) => i.amount !== null && i.amount !== undefined);
      const ind = (r.indents ?? [])[0];
      const vendorName = (ind?.approved_vendor_name || ind?.vendor_name1 || '')?.trim() || null;
      return {
        id: r.id,
        itemId: r.itemId === null ? null : String(r.itemId),
        itemName: r.itemName,
        groupHead: r.groupHead,
        uom: r.uom,
        quantity,
        issued,
        remaining,
        pending,
        open,
        complete: remaining <= EPS,
        note: r.note,
        indentNumber: r.indentNumber,
        issuedAmount: amounts.length ? amounts.reduce((s, i) => s + num(i.amount), 0) : null,
        vendorName,
      };
    });
  const complete = lines.filter((l) => l.complete).length;
  const suggestedVendor = lines.find((l) => l.vendorName)?.vendorName ?? null;
  return { lines, total: lines.length, complete, waiting: lines.length === 0 || complete < lines.length, suggestedVendor };
}

/** Why a repair cannot complete yet, or null when it can. Only an in-house REPAIR / BREAKDOWN with "material required" is gated.
 * Partial issued parts are allowed to complete the repair; unused parts can be returned to inventory via Store Issue Return.
 */
export function partsBlockMessage(
  wo: { type: string; materialRequired?: boolean | null; typeOfWork?: string | null; outsourceStatus?: string | null },
  summary: PartsSummary,
): string | null {
  if (wo.type !== 'REPAIR' && wo.type !== 'BREAKDOWN') return null;
  if (wo.materialRequired !== true) return null;
  if (wo.typeOfWork === 'out_source' || wo.typeOfWork === 'outhouse' || wo.outsourceStatus) return null;
  if (summary.total === 0) return 'List the parts this repair needs, or mark it as "material not required", before completing it';
  const anyIssued = summary.lines.some((l) => l.issued > 0);
  if (!anyIssued) {
    return 'No parts have been issued from the Store yet. At least partial parts must be issued before completing the repair';
  }
  return null;
}
