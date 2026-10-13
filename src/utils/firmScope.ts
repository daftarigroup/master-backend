import { ApiError } from './ApiError';
import { UserAuthContext } from './currentUser';

// Server-side firm scoping for new and rewritten endpoints. Generalises the rules of
// buildWorkOrderScope (maintenance/services/workOrder.service.ts) without its crash:
// raw BigInt('all') throws a SyntaxError and surfaces as a 500, so every id that arrives
// from a query string or body goes through parseFirmId / parseBigIntId instead.

/** Sentinel that matches no row. Firm ids start at 1, so -1n can never be a real firm. */
export const NO_FIRM = -1n;

const DIGITS = /^\d+$/;

/**
 * Parses a firm id from user input. Returns null for undefined, '', 'all', 'none', or anything
 * that is not a plain positive integer, so callers can treat "no specific firm" uniformly.
 */
export function parseFirmId(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value > 0n ? value : null;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!DIGITS.test(s)) return null;
  const n = BigInt(s);
  return n > 0n ? n : null;
}

/** Like parseFirmId but for ids that must be present and valid: bad input is a 400, never a 500. */
export function parseBigIntId(value: unknown, label = 'id'): bigint {
  const parsed = parseFirmId(value);
  if (parsed === null) throw ApiError.badRequest(`Invalid ${label}`);
  return parsed;
}

export type FirmScope = { all: true } | { all: false; firmIds: bigint[] };

/**
 * Which firms a caller may read.
 * - SUPER_ADMIN: the requested firm, otherwise every firm.
 * - Everyone else (ADMIN and USER are treated alike, as in buildWorkOrderScope): their
 *   permittedFirms, narrowed to the requested firm when one is given. A request for a firm
 *   outside the permitted list, or a caller with none, matches nothing.
 * `requested` may be 'all', '' or junk: those mean "no specific firm".
 */
export function resolveFirmScope(ctx: UserAuthContext | null, requested?: unknown): FirmScope {
  if (!ctx) return { all: false, firmIds: [NO_FIRM] };
  const wanted = parseFirmId(requested);

  if (ctx.role === 'SUPER_ADMIN') {
    return wanted === null ? { all: true } : { all: false, firmIds: [wanted] };
  }

  const permitted = ctx.permittedFirms;
  if (wanted !== null) {
    return { all: false, firmIds: permitted.includes(wanted) ? [wanted] : [NO_FIRM] };
  }
  return { all: false, firmIds: permitted.length > 0 ? [...permitted] : [NO_FIRM] };
}

/** Prisma `where` fragment for a scope on a single firm column, e.g. firmWhere(scope) or firmWhere(scope, 'machine.firmId'). */
export function firmWhere(scope: FirmScope, field = 'firmId'): Record<string, unknown> {
  if (scope.all) return {};
  const clause = { in: scope.firmIds };
  const path = field.split('.');
  return path.reduceRight<Record<string, unknown>>((acc, key, i) => ({ [key]: i === path.length - 1 ? clause : acc }), {});
}

/** Throws 403 unless the caller may write into this firm. */
export function assertFirmWritable(ctx: UserAuthContext | null, firmId: bigint): void {
  if (!ctx) throw ApiError.forbidden('Not allowed to write to this firm');
  if (ctx.role === 'SUPER_ADMIN') return;
  if (!ctx.permittedFirms.includes(firmId)) throw ApiError.forbidden('Not allowed to write to this firm');
}

/** For endpoints that need exactly one firm (e.g. the ledger): 'all' or missing is a 400, not a crash. */
export function requireSingleFirm(ctx: UserAuthContext | null, requested: unknown): bigint {
  const firmId = parseFirmId(requested);
  if (firmId === null) throw ApiError.badRequest('A specific firm is required (firmId must be a number, not "all")');
  const scope = resolveFirmScope(ctx, firmId);
  if (scope.all || !scope.firmIds.includes(firmId)) throw ApiError.forbidden('No access to this firm');
  return firmId;
}

type FirmMatch = bigint | { in: bigint[] };
export type MachineRowFirmFilter = {
  OR: Array<
    | { firmId: FirmMatch }
    | { machine: { firmId: FirmMatch } }
    | { machine: { assignments: { some: { endedAt: null; firmId: FirmMatch } } } }
  >;
};

/**
 * Restricts rows that carry their own `firmId` and a `machine` (plans, breakdown reports, ...) to the caller's firms.
 * `requested` may be 'all', '' or junk, which means "no specific firm" (raw BigInt() of those used to be a 500).
 * SUPER_ADMIN with no specific firm is unrestricted (returns null); everyone else is limited to their permitted firms,
 * narrowed to the requested one when it is permitted, and to nothing when it is not.
 */
export function machineRowFirmFilter(ctx: UserAuthContext, requested?: unknown): MachineRowFirmFilter | null {
  const scope = resolveFirmScope(ctx, requested);
  if (scope.all) return null;
  const match: FirmMatch = scope.firmIds.length === 1 && ctx.role === 'SUPER_ADMIN' ? scope.firmIds[0] : { in: scope.firmIds };
  return {
    OR: [
      { firmId: match },
      { machine: { firmId: match } },
      { machine: { assignments: { some: { endedAt: null, firmId: match } } } },
    ],
  };
}
